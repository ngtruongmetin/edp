const bcrypt = require("bcrypt");
const db = require("../db");
const updateExcel = require("../utils/updateExcel");

const DEFAULT_PASSWORD = "Nt@12345";
const DEFAULT_PIN = "032026";

async function resetGvcnBcsDefaults() {
  console.log("Reset mật khẩu GVCN + Ban cán sự về mặc định...");

  db.all("SELECT id,name FROM classes", [], async (err, rows) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }

    const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

    for (const c of rows) {
      await new Promise((resolve, reject) => {
        db.run(
          `
            UPDATE accounts
            SET
              password_gvcn=?,
              password_bcs=?,
              pin_bcs=?,
              password_changed=0,
              password_changed_gvcn=0,
              password_changed_bcs=0
            WHERE class_id=?
          `,
          [hash, hash, DEFAULT_PIN, c.id],
          (e) => (e ? reject(e) : resolve())
        );
      });

      updateExcel(c.name, {
        gvcn_password: DEFAULT_PASSWORD,
        bcs_password: DEFAULT_PASSWORD,
        pin_bcs: DEFAULT_PIN,
      });

      console.log("Reset:", c.name);
    }

    console.log("Hoàn tất reset GVCN + Ban cán sự.");
    process.exit(0);
  });
}

resetGvcnBcsDefaults();
