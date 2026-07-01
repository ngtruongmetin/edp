import { useEffect, useState } from "react"
import { api } from "../api/api"
import Navbar from "../components/Navbar"
import ClassSelector from "../components/ClassSelector"
import { usePageTitle } from "../utils/usePageTitle"

import toast from "react-hot-toast"

export default function Login(){
  usePageTitle("EDP | Đăng nhập")

  const [role,setRole] = useState("co_do")

  const [classes,setClasses] = useState<any[]>([])
  const [className,setClassName] = useState("")

  const [username,setUsername] = useState("")
  const [password,setPassword] = useState("")

  const [showPassword,setShowPassword] = useState(false)

  useEffect(()=>{

    loadClasses()
    checkLogin()

  },[])

  async function loadClasses(){

    try{

      const res = await api.get("/classes")
      setClasses(res.data)

    }catch(err){

      console.error(err)

    }

  }

  async function checkLogin(){

    try{

      const res = await api.get("/auth/me")

      const role = res.data.role

      window.location.href=`/${role}/dashboard`

    }catch{}

  }

  const changeRole = (r:string)=>{
    setRole(r)
    setClassName("")
    setUsername("")
    setPassword("")
  }

  const submit = async (e?:React.FormEvent)=>{

    e?.preventDefault()

    try{

      if(role==="admin"){

        if(!username || !password){
          toast.error("Vui lòng nhập đầy đủ thông tin")
          return
        }

        await api.post("/auth/admin/login",{
          username,
          password
        })

      }else{

        if(!className){
          toast.error("Vui lòng chọn lớp")
          return
        }

        if(!password){
          toast.error("Vui lòng nhập mật khẩu")
          return
        }

        await api.post("/auth/login",{
          role,
          class_name:className,
          password
        })

      }

      toast.success("Đăng nhập thành công")

      window.location.href=`/${role}/dashboard`

    }catch{

      toast.error("Sai thông tin đăng nhập")

    }

  }

  return(

    <div className="min-h-screen bg-gray-50">

      <Navbar />

      <form
        onSubmit={submit}
        className="p-4 space-y-4 max-w-md mx-auto md:mt-12"
      >

        {/* ROLE */}

        <div className="bg-white p-4 rounded-lg shadow">

          <div className="font-semibold mb-3">
            Vai trò
          </div>

          <div className="space-y-2">

            <label className="flex gap-2">
              <input
                type="radio"
                checked={role==="admin"}
                onChange={()=>changeRole("admin")}
              />
              Quản trị
            </label>

            <label className="flex gap-2">
              <input
                type="radio"
                checked={role==="gvcn"}
                onChange={()=>changeRole("gvcn")}
              />
              Giáo viên chủ nhiệm
            </label>

            <label className="flex gap-2">
              <input
                type="radio"
                checked={role==="bancansu"}
                onChange={()=>changeRole("bancansu")}
              />
              Ban cán sự
            </label>

            <label className="flex gap-2">
              <input
                type="radio"
                checked={role==="co_do"}
                onChange={()=>changeRole("co_do")}
              />
              Cờ đỏ
            </label>

          </div>

        </div>


        {/* ADMIN LOGIN */}

        {role==="admin" && (

          <div className="space-y-3">

            <input
              className="w-full p-3 border rounded-lg"
              placeholder="Tên người dùng"
              value={username}
              onChange={e=>setUsername(e.target.value)}
            />

            <div className="relative">

              <input
                type={showPassword ? "text" : "password"}
                className="w-full p-3 border rounded-lg pr-14"
                placeholder="Mật khẩu"
                value={password}
                onChange={e=>setPassword(e.target.value)}
              />

              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-600"
                onClick={()=>setShowPassword(v=>!v)}
              >
                {showPassword ? "Ẩn" : "Xem"}
              </button>

            </div>

          </div>

        )}


        {/* CLASS LOGIN */}

        {role!=="admin" && (

          <ClassSelector
            classes={classes}
            value={className}
            onChange={setClassName}
          />

        )}

        {role!=="admin" && (

          <div className="relative">

            <input
              type={showPassword ? "text" : "password"}
              className="w-full p-3 border rounded-lg pr-14"
              placeholder="Mật khẩu"
              value={password}
              onChange={e=>setPassword(e.target.value)}
            />

            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-600"
              onClick={()=>setShowPassword(v=>!v)}
            >
              {showPassword ? "Ẩn" : "Xem"}
            </button>

          </div>

        )}

        <button
          type="submit"
          className="w-full bg-primary text-white p-3 rounded-lg"
        >
          Đăng nhập
        </button>

      </form>

    </div>

  )

}
