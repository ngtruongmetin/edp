const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../../db");

const router = express.Router();

/*
CLASS LOGIN
*/
router.post("/login", (req, res) => {

    const { role, class_name, password } = req.body;

    if (!role || !class_name || !password) {
        return res.status(400).json({ error: "Missing fields" });
    }

    db.get(`
        SELECT a.*, c.name as class_name
        FROM accounts a
        JOIN classes c ON a.class_id = c.id
        WHERE c.name = ?
    `, [class_name], async (err, acc) => {

        if (err) return res.status(500).json({ error: err.message });
        if (!acc) return res.status(401).json({ error: "Account not found" });

        let hash = null;

        if (role === "gvcn") hash = acc.password_gvcn;
        if (role === "bancansu") hash = acc.password_bcs;
        if (role === "co_do") hash = acc.password_codo;

        if (!hash) return res.status(400).json({ error: "Invalid role" });

        const ok = await bcrypt.compare(password, hash);

        if (!ok) {
            return res.status(401).json({ error: "Wrong password" });
        }

        req.session.regenerate((sessionErr) => {
            if (sessionErr) return res.status(500).json({ error: sessionErr.message })

            req.session.user = {
                class_id: acc.class_id,
                class_name: acc.class_name,
                role,
            };


            const rolePasswordChanged =
                role === "bancansu"
                    ? acc.password_changed_bcs
                    : role === "co_do"
                        ? acc.password_changed_codo
                        : role === "gvcn"
                            ? acc.password_changed_gvcn
                            : acc.password_changed

            req.session.save((saveErr) => {
                if (saveErr) {
                    return res.status(500).json({ error: saveErr.message });
                }

                res.json({
                    success: true,
                    role,
                    password_changed: rolePasswordChanged === 1,
                    needs_password_change: rolePasswordChanged !== 1,
                });
            });;
        })

    });

});


/*
ADMIN LOGIN
*/
router.post("/admin/login", (req, res) => {

    const { username, password } = req.body;

    db.get(`
        SELECT *
        FROM admins
        WHERE username = ?
    `, [username], async (err, admin) => {

        if (err) return res.status(500).json({ error: err.message });
        if (!admin) return res.status(401).json({ error: "Admin not found" });

        const ok = await bcrypt.compare(password, admin.password);

        if (!ok) {
            return res.status(401).json({ error: "Wrong password" });
        }

        req.session.regenerate((sessionErr) => {
            if (sessionErr) return res.status(500).json({ error: sessionErr.message })
            req.session.user = {
                role: "admin",
                username: admin.username
            };

            req.session.save((saveErr) => {
                if (saveErr) {
                    return res.status(500).json({ error: saveErr.message });
                }

                res.json({
                    success: true,
                    role: "admin",
                    password_changed: true,
                    needs_password_change: false
                });
            });
        })

    });

});


/*
LOGOUT
*/
router.post("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ error: err.message })
        res.clearCookie("connect.sid", {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
        })
        res.json({ success: true });
    });

});


/*
CURRENT USER
*/
router.get("/me", (req, res) => {

    if (!req.session.user) {
        return res.status(401).json({ error: "Not logged" });
    }

    res.json(req.session.user);

});


module.exports = router;
