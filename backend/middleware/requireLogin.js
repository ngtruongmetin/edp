module.exports = function(req,res,next){

  if(!req.session.user){
    return res.status(401).json({error:"Not logged"})
  }

  const legacyClassRole = `ban${"cansu"}`
  if (req.session.user.role === legacyClassRole) {
    req.session.user.role = "ban_can_su"
  }

  next()

}
