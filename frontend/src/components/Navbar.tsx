import { useState, useEffect } from "react"
import { NavLink, useNavigate } from "react-router-dom"
import { api } from "../api/api"

export default function Navbar() {

  const [menuOpen, setMenuOpen] = useState(false)
  const [user, setUser] = useState<any>(null)

  const navigate = useNavigate()

  useEffect(() => {
    loadUser()
  }, [])

  async function loadUser() {
    try {
      const res = await api.get("/auth/me")
      setUser(res.data)
    } catch {
      setUser(null)
    }
  }

  async function handleLogout() {
    try {
      await api.post("/auth/logout")
      setUser(null)
      navigate("/")
    } catch (err) {
      console.error(err)
    }
  }

  function closeMenu() {
    setMenuOpen(false)
  }

  function getDashboardPath(role:string){

    if(role==="admin") return "/admin/dashboard"
    if(role==="gvcn") return "/gvcn/dashboard"
    if(role==="ban_can_su") return "/ban_can_su/dashboard"
    if(role==="co_do") return "/co_do/dashboard"

    return "/"
  }

  const dashboardPath = user ? getDashboardPath(user.role) : "/"

  return (

    <header className="bg-[#2e77df] text-white shadow">

      <div className="max-w-6xl mx-auto px-4">

        <div className="flex items-center h-14">

          {/* logo */}
          <NavLink
            to="/"
            className="flex items-center font-semibold text-lg"
            onClick={closeMenu}
          >
            <img src="/logowhiteonly.png" className="h-7 w-auto mr-2"/>
            EDP
          </NavLink>


          {/* desktop nav */}
          <nav className="hidden md:flex ml-10 space-x-6 text-sm font-medium">

            {user && (
              <NavLink
                to={dashboardPath}
                className={({ isActive }) =>
                  `px-3 py-2 rounded transition ${
                    isActive
                      ? "bg-blue-700 text-white"
                      : "hover:bg-blue-700"
                  }`
                }
              >
                Dashboard
              </NavLink>
            )}

            <NavLink
              to="/schedule"
              className={({ isActive }) =>
                `px-3 py-2 rounded transition ${
                  isActive
                    ? "bg-blue-700 text-white"
                    : "hover:bg-blue-700"
                }`
              }
            >
              Lịch trực
            </NavLink>

          </nav>


          {/* right side desktop */}
          {/* right side desktop */}
          <div className="hidden md:flex ml-auto items-center space-x-4">

            {user ? (
              <button
                onClick={handleLogout}
                className="bg-white text-[#2e77df] px-4 py-1.5 rounded text-sm font-semibold hover:bg-blue-100 transition"
              >
                Đăng xuất
              </button>
            ) : (
              <NavLink
                to="/login"
                className="bg-white text-[#2e77df] px-4 py-1.5 rounded text-sm font-semibold hover:bg-blue-100 transition"
              >
                Đăng nhập
              </NavLink>
            )}

          </div>


          {/* hamburger */}
          <button
            className="ml-auto md:hidden flex flex-col justify-center items-center w-8 h-8"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span className={`block h-0.5 w-6 bg-white transition-transform duration-300 ${menuOpen ? "rotate-45 translate-y-1.5" : ""}`} />
            <span className={`block h-0.5 w-6 bg-white my-1 transition-opacity duration-300 ${menuOpen ? "opacity-0" : ""}`} />
            <span className={`block h-0.5 w-6 bg-white transition-transform duration-300 ${menuOpen ? "-rotate-45 -translate-y-1.5" : ""}`} />
          </button>

        </div>

      </div>


      {/* mobile menu */}
      <div
        className={`md:hidden bg-[#2e77df] border-t border-blue-400 overflow-hidden transition-all duration-300 ${
          menuOpen ? "max-h-64" : "max-h-0"
        }`}
      >

        <nav className="flex flex-col px-4 py-3 space-y-2 text-sm">

          {user && (
            <NavLink
              to={dashboardPath}
              onClick={closeMenu}
              className="py-2 hover:bg-blue-700 px-2 rounded"
            >
              Dashboard
            </NavLink>
          )}

          <NavLink
            to="/schedule"
            onClick={closeMenu}
            className="py-2 hover:bg-blue-700 px-2 rounded"
          >
            Lịch trực
          </NavLink>

          {user ? (
            <button
              onClick={()=>{
                closeMenu()
                handleLogout()
              }}
              className="text-left py-2 hover:bg-blue-700 px-2 rounded"
            >
              Đăng xuất
            </button>
          ) : (
            <NavLink
              to="/login"
              onClick={closeMenu}
              className="py-2 hover:bg-blue-700 px-2 rounded"
            >
              Đăng nhập
            </NavLink>
          )}

        </nav>

      </div>

    </header>

  )
}
