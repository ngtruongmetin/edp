import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { api } from "../api/api"

type User = {
  role:string
  class_id?:number
  class_name?:string
  username?:string
}

type AuthType = {
  user:User|null
  loading:boolean
  refresh:()=>Promise<void>
  logout:()=>Promise<void>
}

const AuthContext = createContext<AuthType | null>(null)

export function AuthProvider({children}:{children:ReactNode}){

  const [user,setUser] = useState<User|null>(null)
  const [loading,setLoading] = useState(true)

  async function refresh(){

    try{

      const res = await api.get("/auth/me")
      setUser(res.data)

    }catch{

      setUser(null)

    }

    setLoading(false)

  }

  async function logout(){

    await api.post("/auth/logout")
    setUser(null)

  }

  useEffect(()=>{
    refresh()
  },[])

  return(

    <AuthContext.Provider value={{user,loading,refresh,logout}}>

      {children}

    </AuthContext.Provider>

  )

}

export function useAuth(){

  const ctx = useContext(AuthContext)

  if(!ctx){
    throw new Error("useAuth must be used inside AuthProvider")
  }

  return ctx

}