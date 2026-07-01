import { Outlet } from "react-router-dom"
import RequireRole from "../../components/RequireRole"

export default function AdminLayout(){

  return(

    <RequireRole role="admin">

      <Outlet />

    </RequireRole>

  )

}