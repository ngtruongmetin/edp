const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const initDb = require("./utils/init");
const { startDutyAutoCreateScheduler } = require("./utils/dutyAutoCreate")

const app = express();

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return;
    }

    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }

        const equalsIndex = trimmed.indexOf("=");
        if (equalsIndex === -1) {
            continue;
        }

        const key = trimmed.slice(0, equalsIndex).trim();
        let value = trimmed.slice(equalsIndex + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

loadEnvFile(path.join(__dirname, "..", ".env"));

initDb()
startDutyAutoCreateScheduler({ repairOnStart: true })

// Need larger payloads for base64 image uploads / excel uploads.
app.use(express.json({ limit: "25mb" }));

// Serve signature images.
app.use("/assets", express.static(path.join(__dirname, "assets")));

app.use(session({
    secret: process.env.SESSION_SECRET || "edp-secret-dang-ngoc-truong",
    resave: false,
    saveUninitialized: false
}));

app.use("/api/auth", require("./modules/auth/routes"));
app.use("/api/account", require("./modules/account/routes"));
app.use("/api/rules", require("./modules/rules/routes"))
app.use("/api/classes", require("./modules/classes/routes"))
app.use("/api/schedule", require("./modules/schedule/routes"));
app.use("/api/duty", require("./modules/duty/routes"))
app.use("/api/bonus", require("./modules/bonus/routes"))
app.get("/", (req,res)=>{
    res.send("EDP running");
});

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, ()=>{
    console.log("EDP running");
});
