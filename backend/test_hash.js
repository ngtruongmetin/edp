const bcrypt = require("bcrypt")

const password = "kdg5fa"
const hash = "$2b$10$Cu9MD384yaH4HByNc20VT.iKJnY5vGZGifTVKHgSE8iR2PWLeH7xG"

bcrypt.compare(password, hash, (err, isMatch) => {
  if (err) {
    console.error("Error:", err.message)
    process.exit(1)
  }
  
  console.log(`Password: ${password}`)
  console.log(`Hash: ${hash}`)
  console.log(`Match: ${isMatch ? "✅ YES" : "❌ NO"}`)
  
  process.exit(0)
})
