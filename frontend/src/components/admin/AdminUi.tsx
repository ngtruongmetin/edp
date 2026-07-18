import type { ReactNode } from "react"
import { Link } from "react-router-dom"

import Footer from "../Footer"
import Navbar from "../Navbar"

type AdminPageShellProps = {
  children: ReactNode
  maxWidthClassName?: string
}

type AdminBreadcrumbProps = {
  current: string
}

type AdminHeroCardProps = {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
  stats?: ReactNode
}

type AdminSectionCardProps = {
  children: ReactNode
  className?: string
}

function joinClasses(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(" ")
}

export function AdminPageShell({
  children,
  maxWidthClassName = "max-w-7xl",
}: AdminPageShellProps) {
  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,#edf5ff_0%,#f8fbff_34%,#f3f6fb_100%)]">
      <Navbar />
      <div
        className={joinClasses(
          "mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8",
          maxWidthClassName,
        )}
      >
        {children}
      </div>
      <Footer />
    </div>
  )
}

export function AdminBreadcrumb({ current }: AdminBreadcrumbProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <Link to="/admin/dashboard" className="transition hover:text-[#2e77df]">
        Bảng điều khiển
      </Link>
      <span>/</span>
      <span className="font-medium text-slate-700">{current}</span>
    </div>
  )
}

export function AdminHeroCard({
  eyebrow,
  title,
  description,
  actions,
  stats,
}: AdminHeroCardProps) {
  return (
    <section className="edp-glass-panel rounded-[32px] px-6 py-6 text-slate-900">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[#2e77df]/70">
            {eyebrow}
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
            {title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            {description}
          </p>
        </div>

        {stats ? <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[320px]">{stats}</div> : null}
        {actions ? <div className="flex flex-wrap gap-3 lg:justify-end">{actions}</div> : null}
      </div>
    </section>
  )
}

export function AdminSectionCard({ children, className }: AdminSectionCardProps) {
  return (
    <section className={joinClasses("edp-glass-panel rounded-[32px] p-5 sm:p-6", className)}>
      {children}
    </section>
  )
}
