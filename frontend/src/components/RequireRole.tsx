import { useEffect, useState, type ReactNode } from "react"
import { Navigate } from "react-router-dom"
import { api } from "../api/api"

type Props = {
  role: string
  children: ReactNode
}

export default function RequireRole({ role, children }: Props) {

  const [status, setStatus] = useState<"loading" | "ok" | "deny">("loading")

  useEffect(() => {

    async function checkAuth(){

      try{

        const res = await api.get("/auth/me")

        if(res.data.role === role){
          setStatus("ok")
        }else{
          setStatus("deny")
        }

      }catch{

        setStatus("deny")

      }

    }

    checkAuth()

  }, [role])

  if(status === "loading"){
    return null
  }

  if(status === "deny"){
    return <Navigate to="/login" replace />
  }

  return <>{children}</>

}