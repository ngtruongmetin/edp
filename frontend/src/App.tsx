import { BrowserRouter, Routes, Route } from "react-router-dom"

import Landing from "./pages/Landing"
import Login from "./pages/Login"
import NotFound from "./pages/NotFound"
import OpenInBrowser from "./pages/OpenInBrowser"
import Schedule from "./pages/Schedule"

import AdminLayout from "./pages/admin/AdminLayout"
import AdminDashboard from "./pages/admin/AdminDashboard"
import AdminClasses from "./pages/admin/AdminClasses"
import AdminRules from "./pages/admin/AdminRules"
import AdminSchedule from "./pages/admin/AdminSchedule"
import AdminDutyManage from "./pages/admin/AdminDutyManage"
import AdminWeeklySummary from "./pages/admin/AdminWeeklySummary"
import AdminMonthSummary from "./pages/admin/AdminMonthSummary"
import AdminSemesterSummary from "./pages/admin/AdminSemesterSummary"
import AdminYearSummary from "./pages/admin/AdminYearSummary"
import AdminPinLookup from "./pages/admin/AdminPinLookup"
import AdminTimetable from "./pages/admin/AdminTimetable"

import CodoDashboard from "./pages/co_do/CodoDashboard"
import CodoLayout from "./pages/co_do/CodoLayout"
import CodoDuty from "./pages/co_do/CodoDuty"

import BanCanSuLayout from "./pages/ban_can_su/BanCanSuLayout"
import BanCanSuDashboard from "./pages/ban_can_su/BanCanSuDashboard"

import GvcnLayout from "./pages/gvcn/GvcnLayout"
import GvcnDashboard from "./pages/gvcn/GvcnDashboard"

import { Toaster } from "react-hot-toast"

export default function App(){

  return(

    <BrowserRouter>

      <Toaster
        position="top-right"
        toastOptions={{
          duration:3000,
          style:{
            borderRadius:"10px",
            background:"#ffffff",
            color:"#2e77df"
          }
        }}
      />

      <Routes>

        {/* public */}
        <Route path="/" element={<Landing/>}/>
        <Route path="/login" element={<Login/>}/>
        <Route path="/open-in-browser" element={<OpenInBrowser/>}/>
        <Route path="/schedule" element={<Schedule/>}/>

        {/* admin */}
        <Route path="/admin" element={<AdminLayout/>}>
          <Route path="dashboard" element={<AdminDashboard/>}/>
          <Route path="classes" element={<AdminClasses/>}/>
          <Route path="rules" element={<AdminRules/>}/>
          <Route path="schedule" element={<AdminSchedule/>}/>
          <Route path="duty" element={<AdminDutyManage/>}/>
          <Route path="timetable" element={<AdminTimetable/>}/>
          <Route path="pin-lookup" element={<AdminPinLookup/>}/>
          <Route path="weekly-summary" element={<AdminWeeklySummary/>}/>
          <Route path="month-summary" element={<AdminMonthSummary/>}/>
          <Route path="semester-summary" element={<AdminSemesterSummary/>}/>
          <Route path="year-summary" element={<AdminYearSummary/>}/>
          {/* mọi route admin sai */}
          <Route path="*" element={<NotFound/>}/>
        </Route>

        <Route path="/co_do" element={<CodoLayout/>}>
          <Route path="dashboard" element={<CodoDashboard/>}/>
          <Route path="duty" element={<CodoDuty/>}/>
          <Route path="duty/:id" element={<CodoDuty/>}/>
          {/* mọi route co_do sai */}
          <Route path="*" element={<NotFound/>}/>
        </Route>

        <Route path="/bancansu" element={<BanCanSuLayout/>}>
          <Route path="dashboard" element={<BanCanSuDashboard/>}/>
          {/* mọi route bancansu sai */}
          <Route path="*" element={<NotFound/>}/>
        </Route>

        <Route path="/gvcn" element={<GvcnLayout/>}>
          <Route path="dashboard" element={<GvcnDashboard/>}/>
          {/* mọi route gvcn sai */}
          <Route path="*" element={<NotFound/>}/>
        </Route>

        {/* global 404 */}
        <Route path="*" element={<NotFound/>}/>

      </Routes>

    </BrowserRouter>

  )

}
