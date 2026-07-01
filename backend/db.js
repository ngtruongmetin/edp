const path = require("path")
const sqlite3 = require("sqlite3").verbose();

const dbPath = path.join(__dirname, "edp.db")
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error(err);
    } else {
        console.log("SQLite connected");
    }
});

// Enforce foreign key constraints (must be enabled per connection in SQLite).
db.run("PRAGMA foreign_keys = ON");

module.exports = db;
