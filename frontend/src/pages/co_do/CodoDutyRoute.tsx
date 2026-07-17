import { Navigate, useLocation, useParams } from "react-router-dom"
import CodoDuty from "./CodoDuty"
import CodoDutyAssistant from "./CodoDutyAssistant"

export default function CodoDutyRoute() {
  const params = useParams()
  const location = useLocation()

  if (!params.id) {
    return <Navigate to="/co_do/dashboard" replace />
  }

  const assistant = new URLSearchParams(location.search).get("assistant") === "1"

  return assistant ? <CodoDutyAssistant key={`assistant-${params.id}`} /> : <CodoDuty key={`duty-${params.id}`} />
}
