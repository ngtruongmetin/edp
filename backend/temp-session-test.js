const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { pool } = require('./config/database');

const app = express();
app.use((req, res, next) => {
    const origSetHeader = res.setHeader.bind(res);
    res.setHeader = (...args) => {
        if (args[0] === 'Set-Cookie') {
            console.log('setHeader called', args[1]);
        }
        return origSetHeader(...args);
    };
    next();
});
app.use(session({
    secret: 'test',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: new PgSession({ pool, tableName: 'session', createTableIfMissing: true, pruneSessionInterval: 900 }),
    cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 30 * 24 * 60 * 60 * 1000 },
}));
app.get('/test', (req, res) => {
    req.session.regenerate((err) => {
        console.log('regenerate err', err);
        req.session.user = { ok: true };
        req.session.save((saveErr) => {
            console.log('save err', saveErr);
            console.log('sessionID', req.sessionID);
            console.log('res headers before send', res.getHeaders());
            res.json({ ok: true, sid: req.sessionID });
        });
    });
});
app.listen(3011, () => console.log('listening on 3011'));
