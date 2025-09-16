const axios = require('axios');
const logger = require('../utils/logger.util');

class AIController {
    constructor() {
        // Groq (OpenAI-compatible) configuration
        this.groqApiKey = process.env.GROQ_API_KEY || '';
        // Default to a currently available model. You can override via GROQ_MODEL in .env
        this.groqModel = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
        
        // Retry configuration for API reliability
        this.maxRetries = parseInt(process.env.GROQ_MAX_RETRIES) || 3;
        this.baseRetryDelay = parseInt(process.env.GROQ_RETRY_DELAY) || 1000; // 1 second
        this.requestTimeout = parseInt(process.env.GROQ_TIMEOUT) || 30000; // 30 seconds
        
        // Rate limiting tracking
        this.rateLimitResetTime = null;
        this.rateLimitRemaining = null;
        
        // Domain/system instruction to steer chat outputs
        this.systemPrompt = `You're a chatbot that belongs to a web platform oriented to designing user profiles, by creating personal webpages for them, customisable via diverse modules, or components.\n\nThe platform contains 5 total components:\n - Generic component: Consisting of a title and description, with the option of skipping the title by leaving it blank, it allows the user to insert custom markdown content. Its structure is the following, replacing [TITLE] with the actual title, and [DESCRIPTION] with the actual description:\n{\n      \"type\": \"generic\",\n      \"content\": {\n        \"title\": \"[TITLE]\",\n        \"description\": \"[DESCRIPTION]\"\n      }\n}\n - Link list component: Allowing the user to input a maximum of five (5) links, with an optional link image, a link per se, and a title (can be left blank if you want the title to be the link by itself). The component's got 2 available designs: a vertical list, with each item consisting of an image, and its title; or a horizontal grid, with the icon being the main focused, and the title centered at the icon's bottom. The [VERTICAL] parameter represents a boolean, in which true means the first design, and false meaning the second design. \nIts structure is the following, replacing [LINK LIST] with a JSON list for each link object:\n{\n      \"type\": \"linklist\",\n      \"content\": {\n        \"links\": [LINK LIST],\n        \"vertical\": [VERTICAL]\n      }\n}\nEach link object follows the next structure:\n{\n            \"url\": \"[URL]\",\n            \"icon\": \"[ICON]\",\n            \"title\": \"[TITLE]\"\n}\nThe icon shall never be completed with images or files outside of the website itself, that's why you will never upload images, use generic assets, or use images in general. You will let the user complete them. The lack of [ICON] will be completed with null.\n - Spotify component: Allowing the user to input a Spotify playlist link, will autocomplete and display the Spotify embed per se. The component's structure will be the following, where [PLAYLIST-ID] shall be the actual id for the spotify playlist:\n{\n      \"type\": \"spotify\",\n      \"content\": \"[PLAYLIST-ID]\"\n}\n- YouTube component: Allows the user to add a YouTube video link, and will autocomplete the YouTube embed per se. The component's structure will be the following, where [VIDEO-ID] shall be the actual id for the YouTube video:\n{\n      \"type\": \"youtube\",\n      \"content\": \"[VIDEO-ID]\"\n}\n\nThe profile also contains multiple designs and colours:\n - Design: Represented with 2 integers, where 1 represents a layout with a centered profile picture, display name, and social links (special if you want the profile picture to be large), with each component following at the bottom; and 2 represents a compact layout, where the profile picture, display name and social links account for a third of the space occupied by the first layout. The second option is better if you want the component's content to be the most important, while the first one is better for promoting the user itself.\n - Colour: 0 equals dark mode, 1 is orange, 2 is light mode, 3 is green, 4 is blue, 5 is purple/lilac and 6 is yellow/mustard.\n\nWhen the user speaks, you shall answer in JSON format, using the following structure, completing the \"components\" list with components following the structures given before, with 5 being the maximum amount:\n{\n  \"components\": [\n    {\n      \"type\": \"[TYPE]\",\n      \"content\": \"[CONTENT]\"\n    },\n    {\n      \"type\": \"[TYPE]\",\n      \"content\": \"[CONTENT]\"\n    }\n  ],\n  \"profileDesign\": {\n    \"colour\": [COLOUR],\n    \"design\": [DESIGN]\n  }\n}\nYou will give out three alternatives, and only answer with those. Output strictly valid JSON and no extra commentary. If values are not known (like link icons), use null where specified.`;
    }

    /**
     * Calculates exponential backoff delay for retries
     * @param {number} attempt - Current attempt number (0-based)
     * @param {number} baseDelay - Base delay in milliseconds
     * @returns {number} - Delay in milliseconds
     */
    calculateRetryDelay(attempt, baseDelay = this.baseRetryDelay) {
        // Exponential backoff with jitter: baseDelay * (2^attempt) + random(0, 1000)
        const exponentialDelay = baseDelay * Math.pow(2, attempt);
        const jitter = Math.random() * 1000;
        return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
    }

    /**
     * Checks if we should retry based on error type and attempt count
     * @param {Error} error - The error that occurred
     * @param {number} attempt - Current attempt number (0-based)
     * @returns {boolean} - Whether to retry
     */
    shouldRetry(error, attempt) {
        if (attempt >= this.maxRetries) {
            return false;
        }

        // Don't retry on authentication errors
        if (error.response?.status === 401 || error.response?.status === 403) {
            return false;
        }

        // Don't retry on client errors (400-499) except rate limiting
        if (error.response?.status >= 400 && error.response?.status < 500 && error.response?.status !== 429) {
            return false;
        }

        // Retry on network errors, timeouts, and server errors
        if (error.code === 'ECONNABORTED' || 
            error.code === 'ETIMEDOUT' || 
            error.code === 'ENOTFOUND' ||
            error.code === 'ECONNRESET' ||
            error.response?.status >= 500 ||
            error.response?.status === 429) {
            return true;
        }

        return false;
    }

    /**
     * Updates rate limit information from response headers
     * @param {Object} headers - Response headers
     */
    updateRateLimitInfo(headers) {
        try {
            if (headers['x-ratelimit-remaining']) {
                this.rateLimitRemaining = parseInt(headers['x-ratelimit-remaining']);
            }
            if (headers['x-ratelimit-reset']) {
                this.rateLimitResetTime = parseInt(headers['x-ratelimit-reset']) * 1000; // Convert to milliseconds
            }
            
            logger.debug('Rate limit info updated', {
                remaining: this.rateLimitRemaining,
                resetTime: new Date(this.rateLimitResetTime).toISOString()
            });
        } catch (error) {
            logger.warn('Failed to parse rate limit headers', { error: error.message });
        }
    }

    /**
     * Checks if we're currently rate limited
     * @returns {boolean} - Whether we're rate limited
     */
    isRateLimited() {
        if (!this.rateLimitResetTime || !this.rateLimitRemaining) {
            return false;
        }
        
        const now = Date.now();
        const isLimited = this.rateLimitRemaining <= 0 && now < this.rateLimitResetTime;
        
        if (isLimited) {
            const resetIn = Math.ceil((this.rateLimitResetTime - now) / 1000);
            logger.warn('Rate limited', { resetInSeconds: resetIn });
        }
        
        return isLimited;
    }

    /**
     * Enhanced Groq API response validation with comprehensive structure checking
     * @param {Object} response - Axios response object
     * @param {string} requestId - Request identifier for logging
     * @returns {Object} - Validation result with content or fallback
     */
    validateGroqApiResponse(response, requestId) {
        try {
            // Validate response object structure
            if (!response) {
                throw new Error('Response object is null or undefined');
            }

            if (!response.data) {
                throw new Error('Response data is missing');
            }

            // Update rate limit information from headers
            if (response.headers) {
                this.updateRateLimitInfo(response.headers);
            }

            // Validate Groq API response structure
            const { data } = response;
            
            if (!data.choices) {
                throw new Error('Response missing choices array');
            }

            if (!Array.isArray(data.choices)) {
                throw new Error('Choices is not an array');
            }

            if (data.choices.length === 0) {
                throw new Error('Choices array is empty');
            }

            const firstChoice = data.choices[0];
            if (!firstChoice) {
                throw new Error('First choice is null or undefined');
            }

            if (!firstChoice.message) {
                throw new Error('Choice missing message object');
            }

            if (!firstChoice.message.content) {
                throw new Error('Message missing content');
            }

            const content = firstChoice.message.content;
            
            logger.debug('Raw API response received, validating and parsing', { requestId });
            
            // Use the new validation and parsing method
            return this.validateAndParseGroqResponse(content, requestId);

        } catch (error) {
            logger.error('Groq API response validation failed', {
                requestId,
                error: error.message,
                responseStructure: {
                    hasResponse: !!response,
                    hasData: !!response?.data,
                    hasChoices: !!response?.data?.choices,
                    choicesLength: response?.data?.choices?.length || 0,
                    hasFirstChoice: !!response?.data?.choices?.[0],
                    hasMessage: !!response?.data?.choices?.[0]?.message,
                    hasContent: !!response?.data?.choices?.[0]?.message?.content,
                    contentType: typeof response?.data?.choices?.[0]?.message?.content
                }
            });
            
            // Return fallback response instead of throwing
            logger.info('Using fallback response due to API response validation failure', { requestId });
            return {
                success: true,
                content: JSON.stringify({
                    a1: { components: [], profileDesign: { colour: 0, design: 1 } },
                    a2: { components: [], profileDesign: { colour: 2, design: 1 } },
                    a3: { components: [], profileDesign: { colour: 1, design: 2 } }
                }),
                fallback: true
            };
        }
    }

    /**
     * Makes a single API request to Groq with timeout handling
     * @param {string} userContent - The user content to send
     * @param {string} requestId - Unique request identifier
     * @returns {Promise<Object>} - Axios response
     */
    async makeGroqApiRequest(userContent, requestId) {
        const requestConfig = {
            method: 'post',
            url: 'https://api.groq.com/openai/v1/chat/completions',
            data: {
                model: this.groqModel,
                messages: [
                    { role: 'system', content: this.systemPrompt },
                    { role: 'user', content: userContent }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.2,
                max_tokens: 900
            },
            headers: {
                Authorization: `Bearer ${this.groqApiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: this.requestTimeout,
            // Add additional axios configuration for better reliability
            validateStatus: (status) => status < 600, // Don't throw on HTTP errors, handle them manually
            maxRedirects: 3,
            // Retry configuration at axios level (in addition to our manual retry logic)
            retry: 0 // Disable axios retry, we handle it manually
        };

        logger.debug('Making Groq API request', { 
            requestId, 
            timeout: `${this.requestTimeout}ms`,
            model: this.groqModel
        });
        
        try {
            const response = await axios(requestConfig);
            logger.debug('API request completed', { 
                requestId, 
                status: response.status 
            });
            return response;
        } catch (error) {
            // Enhance error information
            if (error.code === 'ECONNABORTED') {
                error.message = `Request timeout after ${this.requestTimeout}ms`;
            }
            throw error;
        }
    }

    /**
     * Makes API request with retry logic for transient failures
     * @param {string} userContent - The user content to send
     * @param {string} requestId - Unique request identifier
     * @returns {Promise<Object>} - Validated response content
     */
    async makeGroqApiRequestWithRetry(userContent, requestId) {
        let lastError;
        
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                logger.debug('API attempt starting', { 
                    requestId, 
                    attempt: attempt + 1, 
                    maxAttempts: this.maxRetries + 1 
                });
                
                // Check rate limiting before making request
                if (this.isRateLimited()) {
                    const waitTime = this.rateLimitResetTime - Date.now();
                    if (waitTime > 0 && waitTime < 60000) { // Only wait if less than 1 minute
                        logger.info('Rate limited, waiting before retry', { 
                            requestId, 
                            waitSeconds: Math.ceil(waitTime / 1000) 
                        });
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                    } else {
                        throw new Error('Rate limit exceeded, please try again later');
                    }
                }
                
                const startTime = Date.now();
                const response = await this.makeGroqApiRequest(userContent, requestId);
                const responseTime = Date.now() - startTime;
                
                // Handle HTTP error status codes
                if (response.status >= 400) {
                    const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                    error.response = response;
                    throw error;
                }
                
                // Validate response structure and parse content
                const validationResult = this.validateGroqApiResponse(response, requestId);
                
                logger.info('API request successful', { 
                    requestId, 
                    attempt: attempt + 1, 
                    responseTime: `${responseTime}ms` 
                });
                return validationResult;
                
            } catch (error) {
                lastError = error;
                
                logger.error('API attempt failed', { 
                    requestId, 
                    attempt: attempt + 1, 
                    error: error.message 
                });
                
                // Log detailed error information
                if (error.response) {
                    logger.error('HTTP Error details', {
                        requestId,
                        status: error.response.status,
                        statusText: error.response.statusText,
                        data: error.response.data,
                        errorType: `http_${error.response.status}`
                    });
                    
                    // Update rate limit info even on errors
                    this.updateRateLimitInfo(error.response.headers);
                } else if (error.request) {
                    logger.error('Network Error details', {
                        requestId,
                        code: error.code,
                        message: error.message,
                        errorType: error.code || 'network'
                    });
                } else {
                    logger.error('Request Setup Error', { 
                        requestId, 
                        message: error.message,
                        errorType: 'request_setup'
                    });
                }
                
                // Check if we should retry
                if (!this.shouldRetry(error, attempt)) {
                    logger.info('Not retrying due to error type', { 
                        requestId, 
                        reason: error.message 
                    });
                    break;
                }
                
                // Calculate delay for next attempt
                if (attempt < this.maxRetries) {
                    const delay = this.calculateRetryDelay(attempt);
                    logger.info('Retrying after delay', { 
                        requestId, 
                        delaySeconds: Math.ceil(delay / 1000) 
                    });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        // All attempts failed, throw the last error
        logger.error('All API attempts failed', { 
            requestId, 
            totalAttempts: this.maxRetries + 1,
            finalError: lastError.message
        });
        throw lastError;
    }

    /**
     * Formats context from frontend message format to Groq API expected format
     * Converts {text, sender, timestamp} messages to {user, bot} pairs
     * @param {Array} context - Array of message objects from frontend
     * @returns {Array} - Array of {user, bot} pairs for Groq API
     */
    formatContextForGroq(context) {
        try {
            // Validate context is an array
            if (!Array.isArray(context)) {
                logger.warn('Context is not an array, using empty context', { 
                    receivedType: typeof context 
                });
                return [];
            }

            if (context.length === 0) {
                logger.debug('Empty context array provided');
                return [];
            }

            // Filter out invalid messages and validate structure
            const validMessages = context.filter((msg, index) => {
                try {
                    if (!msg || typeof msg !== 'object') {
                        logger.warn('Invalid message object in context', { 
                            index, 
                            messageType: typeof msg 
                        });
                        return false;
                    }
                    
                    if (!msg.text || typeof msg.text !== 'string' || msg.text.trim() === '') {
                        logger.warn('Message missing valid text content', {
                            index,
                            hasText: !!msg.text,
                            textType: typeof msg.text,
                            textLength: msg.text?.length || 0
                        });
                        return false;
                    }
                    
                    if (!msg.sender || !['user', 'ai'].includes(msg.sender)) {
                        logger.warn('Message has invalid sender', {
                            index,
                            sender: msg.sender,
                            validSenders: ['user', 'ai']
                        });
                        return false;
                    }
                    
                    // Additional validation for text length
                    if (msg.text.length > 5000) {
                        logger.warn('Message too long, truncating', { 
                            index, 
                            originalLength: msg.text.length 
                        });
                        msg.text = msg.text.substring(0, 5000) + '...';
                    }
                    
                    return true;
                } catch (validationError) {
                    logger.error('Error validating message', { 
                        index, 
                        error: validationError.message 
                    });
                    return false;
                }
            });

            logger.debug('Context validation complete', { 
                inputMessages: context.length, 
                validMessages: validMessages.length 
            });

            // Convert messages to user/bot pairs
            const pairs = [];
            let currentPair = {};
            
            for (let i = 0; i < validMessages.length; i++) {
                const msg = validMessages[i];
                
                try {
                    if (msg.sender === 'user') {
                        // Start a new pair with user message
                        if (currentPair.user) {
                            // If we already have a user message without a bot response, 
                            // create a pair with empty bot response
                            pairs.push({
                                user: currentPair.user,
                                bot: ''
                            });
                            logger.debug('Created incomplete pair (user without bot response)', { messageIndex: i });
                        }
                        currentPair = { user: msg.text.trim() };
                    } else if (msg.sender === 'ai') {
                        // Complete the pair with bot response
                        if (currentPair.user) {
                            currentPair.bot = msg.text.trim();
                            pairs.push(currentPair);
                            currentPair = {};
                        } else {
                            // Bot message without preceding user message, skip it
                            logger.warn('Bot message without preceding user message, skipping', { 
                                messageIndex: i,
                                textPreview: msg.text.substring(0, 100) + (msg.text.length > 100 ? '...' : '')
                            });
                        }
                    }
                } catch (pairError) {
                    logger.error('Error processing message', { 
                        messageIndex: i, 
                        error: pairError.message 
                    });
                    // Continue processing other messages
                    continue;
                }
            }
            
            // If we have an incomplete pair (user message without bot response), add it
            if (currentPair.user) {
                pairs.push({
                    user: currentPair.user,
                    bot: ''
                });
                logger.debug('Added final incomplete pair (user without bot response)');
            }

            logger.debug('Context formatting successful', { 
                inputMessages: context.length, 
                outputPairs: pairs.length 
            });
            return pairs;

        } catch (error) {
            logger.error('Critical error in formatContextForGroq', {
                error: error.message,
                contextLength: context?.length || 0,
                stack: error.stack
            });
            
            // Return empty array as fallback to prevent complete failure
            return [];
        }
    }

    /**
     * Creates a fallback response with minimal design alternatives
     * @param {string} reason - Reason for fallback
     * @returns {Object} - Fallback response object
     */
    createFallbackResponse(reason = 'API unavailable') {
        const minimal = {
            components: [],
            profileDesign: { colour: 0, design: 1 }
        };
        
        const fallbackAlternatives = {
            a1: { ...minimal, profileDesign: { colour: 0, design: 1 } },
            a2: { ...minimal, profileDesign: { colour: 2, design: 1 } },
            a3: { ...minimal, profileDesign: { colour: 1, design: 2 } }
        };
        
        logger.info('Creating fallback response', { reason });
        
        return {
            status: 200,
            content: {
                success: true,
                response: JSON.stringify(fallbackAlternatives),
                type: 'chat',
                fallback: true
            }
        };
    }

    /**
     * Validates and parses Groq API JSON response content
     * @param {string} content - Raw JSON content from Groq API
     * @param {string} requestId - Request identifier for logging
     * @returns {Object} - Validation result with parsed content or fallback
     */
    validateAndParseGroqResponse(content, requestId) {
        try {
            // Validate content is a string
            if (typeof content !== 'string') {
                throw new Error(`Content is not a string, got: ${typeof content}`);
            }

            if (content.trim() === '') {
                throw new Error('Content is empty or whitespace only');
            }

            // Parse JSON content
            let parsedContent;
            try {
                parsedContent = JSON.parse(content);
            } catch (parseError) {
                logger.error('JSON parsing failed', {
                    requestId,
                    parseError: parseError.message,
                    contentPreview: content.substring(0, 500)
                });
                throw new Error(`Invalid JSON in response: ${parseError.message}`);
            }

            // Validate parsed content structure
            if (!parsedContent || typeof parsedContent !== 'object') {
                throw new Error('Parsed content is not a valid object');
            }

            // Check for expected alternatives structure (a1, a2, a3)
            const expectedKeys = ['a1', 'a2', 'a3'];
            const hasValidAlternatives = expectedKeys.every(key => 
                parsedContent[key] && typeof parsedContent[key] === 'object'
            );

            if (!hasValidAlternatives) {
                logger.warn('Response missing expected alternatives structure', {
                    requestId,
                    keysFound: Object.keys(parsedContent)
                });
                
                // Try to fix common response format issues
                const fixedContent = this.fixResponseFormat(parsedContent, requestId);
                if (fixedContent) {
                    logger.info('Successfully fixed response format', { requestId });
                    return {
                        success: true,
                        content: JSON.stringify(fixedContent)
                    };
                }
                
                throw new Error('Response missing required alternatives (a1, a2, a3)');
            }

            // Validate each alternative has required structure
            for (const key of expectedKeys) {
                const alt = parsedContent[key];
                
                if (!alt.components || !Array.isArray(alt.components)) {
                    logger.warn('Alternative missing or invalid components array, fixing', {
                        requestId,
                        alternative: key
                    });
                    alt.components = [];
                }
                
                if (!alt.profileDesign || typeof alt.profileDesign !== 'object') {
                    logger.warn('Alternative missing or invalid profileDesign object, fixing', {
                        requestId,
                        alternative: key
                    });
                    alt.profileDesign = { design: 1, colour: 0 };
                } else {
                    // Validate profileDesign values
                    if (typeof alt.profileDesign.colour !== 'number' || 
                        alt.profileDesign.colour < 0 || alt.profileDesign.colour > 6) {
                        logger.warn('Alternative has invalid colour value, fixing', {
                            requestId,
                            alternative: key,
                            invalidColour: alt.profileDesign.colour
                        });
                        alt.profileDesign.colour = 0;
                    }
                    
                    if (typeof alt.profileDesign.design !== 'number' || 
                        (alt.profileDesign.design !== 1 && alt.profileDesign.design !== 2)) {
                        logger.warn('Alternative has invalid design value, fixing', {
                            requestId,
                            alternative: key,
                            invalidDesign: alt.profileDesign.design
                        });
                        alt.profileDesign.design = 1;
                    }
                }
            }

            logger.debug('Response validation successful', { 
                requestId, 
                contentLength: content.length 
            });
            
            return {
                success: true,
                content: JSON.stringify(parsedContent)
            };

        } catch (error) {
            logger.error('Response validation failed', {
                requestId,
                error: error.message
            });
            
            // Return fallback response structure
            const fallbackAlternatives = {
                a1: { components: [], profileDesign: { colour: 0, design: 1 } },
                a2: { components: [], profileDesign: { colour: 2, design: 1 } },
                a3: { components: [], profileDesign: { colour: 1, design: 2 } }
            };
            
            logger.info('Using fallback response due to validation failure', { requestId });
            
            return {
                success: true,
                content: JSON.stringify(fallbackAlternatives),
                fallback: true
            };
        }
    }

    /**
     * Attempts to fix common response format issues
     * @param {Object} parsedContent - Parsed JSON content
     * @param {string} requestId - Request identifier for logging
     * @returns {Object|null} - Fixed content or null if unfixable
     */
    fixResponseFormat(parsedContent, requestId) {
        try {
            // Check if response has alternatives with different key names
            const altKeys = Object.keys(parsedContent);
            
            // Try to map common alternative key patterns
            const keyMappings = [
                ['alt1', 'alt2', 'alt3'],
                ['option1', 'option2', 'option3'],
                ['alternative1', 'alternative2', 'alternative3'],
                ['design1', 'design2', 'design3']
            ];
            
            for (const mapping of keyMappings) {
                if (mapping.every(key => parsedContent[key])) {
                    logger.debug('Found alternative mapping', { 
                        requestId, 
                        mapping: mapping.join(', ') 
                    });
                    return {
                        a1: parsedContent[mapping[0]],
                        a2: parsedContent[mapping[1]],
                        a3: parsedContent[mapping[2]]
                    };
                }
            }
            
            // Check if response is an array of alternatives
            if (Array.isArray(parsedContent) && parsedContent.length >= 3) {
                logger.debug('Found array format', { 
                    requestId, 
                    alternativeCount: parsedContent.length 
                });
                return {
                    a1: parsedContent[0],
                    a2: parsedContent[1],
                    a3: parsedContent[2]
                };
            }
            
            // Check if response has a single alternative that we can replicate
            if (parsedContent.components && parsedContent.profileDesign) {
                logger.debug('Found single alternative, creating variations', { requestId });
                return {
                    a1: { ...parsedContent },
                    a2: { 
                        ...parsedContent, 
                        profileDesign: { 
                            ...parsedContent.profileDesign, 
                            colour: (parsedContent.profileDesign.colour + 1) % 7 
                        } 
                    },
                    a3: { 
                        ...parsedContent, 
                        profileDesign: { 
                            ...parsedContent.profileDesign, 
                            design: parsedContent.profileDesign.design === 1 ? 2 : 1 
                        } 
                    }
                };
            }
            
            return null;
        } catch (error) {
            logger.error('Error fixing response format', { 
                requestId, 
                error: error.message 
            });
            return null;
        }
    }

    /**
     * Creates a standardized success response
     * @param {string} content - Response content (JSON string)
     * @param {Object} metadata - Additional metadata
     * @returns {Object} - Standardized response object
     */
    createSuccessResponse(content, metadata = {}) {
        return {
            status: 200,
            content: {
                success: true,
                response: content,
                type: 'chat',
                ...metadata
            }
        };
    }

    /**
     * Creates a standardized error response
     * @param {string} message - Error message
     * @param {number} status - HTTP status code
     * @param {Object} metadata - Additional metadata
     * @returns {Object} - Standardized error response object
     */
    createErrorResponse(message, status = 500, metadata = {}) {
        return {
            status,
            content: {
                success: false,
                error: message,
                type: 'chat',
                ...metadata
            }
        };
    }

    /**
     * Logs request context for debugging purposes
     * @param {string} message - User message
     * @param {Array} context - Chat context
     * @param {string} operation - Current operation
     */
    logRequestContext(message, context, operation = 'chat_request') {
        logger.info('Request Context', {
            operation: operation.toUpperCase(),
            messageLength: message?.length || 0,
            contextMessages: context?.length || 0,
            groqModel: this.groqModel,
            apiKeyConfigured: !!this.groqApiKey
        });
    }



    /**
     * Validates and sanitizes user input for AI chat requests
     * @param {string} message - User message to validate
     * @param {Array} context - Chat context array to validate
     * @param {string} requestId - Request identifier for logging
     * @returns {Object} - Validation result with success status and sanitized data
     */
    validateChatInput(message, context, requestId) {
        const validation = {
            success: true,
            sanitizedMessage: '',
            validatedContext: [],
            errors: []
        };

        // Validate message content
        if (message === null || message === undefined) {
            validation.success = false;
            validation.errors.push('Message content is required.');
            return validation;
        }

        if (typeof message !== 'string') {
            validation.success = false;
            validation.errors.push('Message must be a text string.');
            return validation;
        }

        // Sanitize message by trimming whitespace
        const trimmedMessage = message.trim();
        
        if (trimmedMessage === '') {
            validation.success = false;
            validation.errors.push('Please enter a message to get design suggestions.');
            return validation;
        }

        // Validate message length limits
        const minLength = 1;
        const maxLength = 2000;
        
        if (trimmedMessage.length < minLength) {
            validation.success = false;
            validation.errors.push('Message is too short. Please provide more details.');
            return validation;
        }

        if (trimmedMessage.length > maxLength) {
            validation.success = false;
            validation.errors.push(`Your message is too long (${trimmedMessage.length} characters). Please keep it under ${maxLength} characters.`);
            return validation;
        }

        // Basic input sanitization - remove potentially harmful characters
        // Keep alphanumeric, spaces, punctuation, and common symbols
        const sanitizedMessage = trimmedMessage.replace(/[^\w\s\-.,!?@#$%^&*()+=[\]{}|;':"<>/\\`~]/g, '');
        
        if (sanitizedMessage.length === 0) {
            validation.success = false;
            validation.errors.push('Message contains only invalid characters. Please use standard text.');
            return validation;
        }

        validation.sanitizedMessage = sanitizedMessage;

        // Validate context array structure
        if (context !== null && context !== undefined) {
            if (!Array.isArray(context)) {
                logger.warn('Context is not an array, using empty context', { 
                    requestId, 
                    receivedType: typeof context 
                });
                validation.validatedContext = [];
            } else {
                // Limit context history size to prevent large payloads and potential abuse
                const maxContextSize = 20;
                const contextToValidate = context.length > maxContextSize ? 
                    context.slice(-maxContextSize) : context;

                logger.debug('Validating context', { 
                    requestId, 
                    totalMessages: context.length, 
                    processingMessages: contextToValidate.length 
                });

                // Validate each context message
                const validMessages = [];
                for (let i = 0; i < contextToValidate.length; i++) {
                    const msg = contextToValidate[i];
                    
                    // Skip null/undefined messages
                    if (!msg || typeof msg !== 'object') {
                        logger.warn('Skipping invalid message: not an object', { 
                            requestId, 
                            index: i 
                        });
                        continue;
                    }

                    // Validate message structure
                    if (!msg.text || typeof msg.text !== 'string') {
                        logger.warn('Skipping message: missing or invalid text', { 
                            requestId, 
                            index: i 
                        });
                        continue;
                    }

                    if (!msg.sender || !['user', 'ai'].includes(msg.sender)) {
                        logger.warn('Skipping message: invalid sender', { 
                            requestId, 
                            index: i, 
                            sender: msg.sender 
                        });
                        continue;
                    }

                    // Sanitize and validate message text
                    const trimmedText = msg.text.trim();
                    if (trimmedText === '') {
                        logger.warn('Skipping message: empty text after trimming', { 
                            requestId, 
                            index: i 
                        });
                        continue;
                    }

                    // Limit individual message length in context
                    const maxContextMessageLength = 1000;
                    let sanitizedText = trimmedText;
                    
                    if (sanitizedText.length > maxContextMessageLength) {
                        sanitizedText = sanitizedText.substring(0, maxContextMessageLength) + '...';
                        logger.warn('Truncated context message', { 
                            requestId, 
                            index: i, 
                            originalLength: trimmedText.length, 
                            truncatedLength: sanitizedText.length 
                        });
                    }

                    // Basic sanitization for context messages
                    sanitizedText = sanitizedText.replace(/[^\w\s\-.,!?@#$%^&*()+=[\]{}|;':"<>/\\`~]/g, '');
                    
                    if (sanitizedText.length === 0) {
                        logger.warn('Skipping message: no valid characters after sanitization', { 
                            requestId, 
                            index: i 
                        });
                        continue;
                    }

                    // Add validated message
                    validMessages.push({
                        text: sanitizedText,
                        sender: msg.sender,
                        timestamp: msg.timestamp || new Date().toISOString()
                    });
                }

                validation.validatedContext = validMessages;
                logger.debug('Context validation complete', { 
                    requestId, 
                    inputMessages: contextToValidate.length, 
                    validMessages: validMessages.length 
                });
            }
        } else {
            validation.validatedContext = [];
        }

        return validation;
    }

    async generateChatResponse(message, context = []) {
        let formattedContext = [];
        const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2);
        
        try {
            // Log AI chat request with sanitized content
            logger.logAIChatRequest(requestId, message, context, {
                groqModel: this.groqModel,
                apiKeyConfigured: !!this.groqApiKey
            });
            
            // Enhanced input validation and sanitization
            const inputValidation = this.validateChatInput(message, context, requestId);
            
            if (!inputValidation.success) {
                const errorMessage = inputValidation.errors.join(' ');
                logger.warn('Input validation failed', { 
                    requestId, 
                    errors: inputValidation.errors 
                });
                return this.createErrorResponse(errorMessage, 400);
            }

            // Use sanitized input
            const sanitizedMessage = inputValidation.sanitizedMessage;
            const validatedContext = inputValidation.validatedContext;

            logger.debug('Input validation successful', { 
                requestId, 
                messageLength: sanitizedMessage.length, 
                contextMessages: validatedContext.length 
            });

            // Check if Groq API key is configured
            if (!this.groqApiKey) {
                logger.warn('No Groq API key configured, using fallback response', { requestId });
                return this.createFallbackResponse('Missing API key');
            }

            // Format validated context array with error handling
            try {
                formattedContext = this.formatContextForGroq(validatedContext);
            } catch (contextError) {
                logger.error('Context formatting failed', { 
                    requestId, 
                    error: contextError.message 
                });
                // Continue with empty context rather than failing
                formattedContext = [];
            }
            
            // Limit context history size to prevent large payloads
            const maxContextPairs = 10;
            if (formattedContext.length > maxContextPairs) {
                logger.info('Context too large, limiting to most recent pairs', { 
                    requestId, 
                    originalPairs: formattedContext.length, 
                    limitedTo: maxContextPairs 
                });
                formattedContext = formattedContext.slice(-maxContextPairs);
            }
            
            // Build context from recent conversation pairs
            const recentPairs = formattedContext.slice(-3)
                .map(p => `User: ${p.user}\nAssistant: ${p.bot}`)
                .join('\n');

            const userContent = `${recentPairs ? recentPairs + '\n' : ''}User: ${sanitizedMessage}\nAssistant: Provide a single JSON object with keys a1, a2, a3. Each value must follow the exact schema and include up to 5 thoughtfully filled components based on the request. Use different designs/colours or content per alternative. Output only the JSON and nothing else.`;

            logger.info('Making Groq API request', { requestId });
            const startTime = Date.now();

            // Make API request with retry logic and comprehensive error handling
            let validationResult;
            try {
                validationResult = await this.makeGroqApiRequestWithRetry(userContent, requestId);
            } catch (apiError) {
                const responseTime = Date.now() - startTime;
                logger.logErrorWithContext(requestId, apiError, {
                    operation: 'groq_api_request',
                    responseTime: `${responseTime}ms`,
                    attempts: 'all_failed'
                });
                
                // Handle specific error scenarios with appropriate user-friendly messages
                if (apiError.code === 'ECONNABORTED' || apiError.message.includes('timeout')) {
                    logger.error('Request timeout - API took longer than expected', { requestId });
                    return this.createErrorResponse(
                        'The AI service is taking longer than expected. Please try again.',
                        503
                    );
                }
                
                if (apiError.response) {
                    const status = apiError.response.status;
                    const errorData = apiError.response.data;
                    
                    logger.error('Final API Error Response', {
                        requestId,
                        status,
                        data: errorData,
                        errorType: `http_${status}`
                    });
                    
                    // Handle rate limiting with more specific messaging
                    if (status === 429) {
                        const resetTime = this.rateLimitResetTime;
                        const waitTime = resetTime ? Math.ceil((resetTime - Date.now()) / 1000) : 60;
                        logger.error('Rate limit exceeded', { 
                            requestId, 
                            resetInSeconds: waitTime 
                        });
                        return this.createErrorResponse(
                            `Too many requests. Please wait ${waitTime > 60 ? 'a few minutes' : waitTime + ' seconds'} and try again.`,
                            429,
                            { retryAfter: waitTime }
                        );
                    }
                    
                    // Handle authentication errors
                    if (status === 401 || status === 403) {
                        logger.error('Authentication failed', { requestId });
                        return this.createFallbackResponse('Authentication failed');
                    }
                    
                    // Handle server errors
                    if (status >= 500) {
                        logger.error('Server error', { requestId, status });
                        return this.createFallbackResponse('Server error');
                    }
                    
                    // Handle other client errors
                    if (status >= 400) {
                        logger.error('Client error', { requestId, status });
                        return this.createErrorResponse(
                            'There was an issue with your request. Please try rephrasing your message.',
                            400
                        );
                    }
                } else if (apiError.request) {
                    logger.error('Network error - no response received', { 
                        requestId, 
                        code: apiError.code 
                    });
                    return this.createErrorResponse(
                        'Unable to connect to AI service. Please check your connection and try again.',
                        503
                    );
                } else {
                    logger.error('Request setup error', { 
                        requestId, 
                        message: apiError.message 
                    });
                    return this.createErrorResponse(
                        'An unexpected error occurred. Please try again.',
                        500
                    );
                }
                
                // Fallback for any unhandled API errors
                return this.createFallbackResponse('API error after retries');
            }

            const responseTime = Date.now() - startTime;
            logger.info('Groq API request completed successfully', { 
                requestId, 
                responseTime: `${responseTime}ms` 
            });

            // Create standardized success response
            const metadata = { responseTime };
            if (validationResult.fallback) {
                metadata.fallback = true;
            }

            logger.info('Successfully processed chat request', { requestId });
            return this.createSuccessResponse(validationResult.content, metadata);

        } catch (error) {
            // Catch-all error handler for any unexpected errors
            logger.logErrorWithContext(requestId, error, {
                operation: 'generate_chat_response',
                messageLength: message?.length || 0,
                contextLength: context?.length || 0,
                formattedContextLength: formattedContext?.length || 0,
                hasApiKey: !!this.groqApiKey,
                model: this.groqModel
            });
            
            // Return user-friendly error without exposing technical details
            return this.createErrorResponse(
                'Something went wrong while processing your request. Please try again.',
                500
            );
        }
    }

    async processAIChat(message, context = []) {
        const startTime = Date.now();
        const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2);
        
        try {
            logger.info('Processing AI chat request', { requestId });
            
            // Perform comprehensive input validation at entry point
            const inputValidation = this.validateChatInput(message, context, requestId);
            
            if (!inputValidation.success) {
                const errorMessage = inputValidation.errors.join(' ');
                logger.warn('Entry point validation failed', { 
                    requestId, 
                    errors: inputValidation.errors 
                });
                return this.createErrorResponse(errorMessage, 400);
            }

            logger.debug('Entry point validation successful', { requestId });

            const result = await this.generateChatResponse(message, context);
            const processingTime = Date.now() - startTime;
            
            logger.info('AI chat processing completed', { 
                requestId, 
                processingTime: `${processingTime}ms`, 
                status: result.status 
            });
            
            // Log success/failure metrics using the logger's built-in response logging
            const success = result.status === 200;
            logger.logAIChatResponse(requestId, success, processingTime, {
                status: result.status,
                errorDetails: success ? null : (result.content?.error || 'No error details')
            });
            
            return result;
            
        } catch (error) {
            const processingTime = Date.now() - startTime;
            logger.logErrorWithContext(requestId, error, {
                operation: 'process_ai_chat',
                processingTime: `${processingTime}ms`,
                messageType: typeof message,
                messageLength: message?.length || 0,
                contextType: typeof context,
                contextLength: Array.isArray(context) ? context.length : 'not array'
            });
            
            // Return a safe fallback response
            return this.createErrorResponse(
                'An unexpected error occurred while processing your request. Please try again.',
                500
            );
        }
    }
}

module.exports = AIController; 