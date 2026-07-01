module.exports = function(roles){

  return (req,res,next)=>{

    if(!req.session.user){
      return res.status(401).json({error:"Not logged"});
    }

    if(!roles.includes(req.session.user.role)){
      return res.status(403).json({error:"Forbidden"});
    }

    next();

  }

}
