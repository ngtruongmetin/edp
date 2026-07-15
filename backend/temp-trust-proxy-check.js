const express = require('express')
const app = express()

app.set('trust proxy', 2)

app.use((req, res) => {
    console.log({
        secure: req.secure,
        protocol: req.protocol,
        forwardedProto: req.headers['x-forwarded-proto'],
        host: req.headers.host,
    })
    res.json({ secure: req.secure })
})

app.listen(3012, () => console.log('listening on 3012'))
