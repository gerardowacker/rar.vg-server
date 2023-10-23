const nodemailer = require('nodemailer')

const config = require('./config.util')

module.exports = class EmailController
{
    connect()
    {
        return new Promise(res =>
        {
            if (!this.transporter)
                this.transporter = nodemailer.createTransport({
                    host: config('MAIL_HOST'),
                    port: 465,
                    secure: true,
                    auth: {
                        user: config('MAIL_ADDRESS'),
                        pass: config('MAIL_PASSWORD')
                    }
                })
            res(this)
        })
    }

    send(subject, body, recipient)
    {
        return new Promise(async res =>
        {
            let email = await this.transporter.sendMail({
                from: `"${config('MAIL_ALIAS')}" <${config('MAIL_ADDRESS')}>`,
                to: recipient,
                subject: subject,
                text: body
            })
            return res({success: true, content: email})
        })
    }
}