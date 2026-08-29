import { Navigate, Outlet, Route, Routes } from 'react-router'
import { ShellLayout } from './components/shell/Shell'
import { Companies } from './views/Companies'

/**
 * A minimal stand-in for a view body — this task's scope is the shell, not
 * any view (see T-260828-12's "Out"). Every later P1-1x task replaces one of
 * these with its real view; until then this proves the route resolved.
 */
function ViewPlaceholder({ title }: { title: string }) {
  return <h1>{title}</h1>
}

/**
 * The route tree: the ten views, the two detail routes, and Settings/Data
 * nested under `/workspace` per X-01 rather than as top-level entries. Every
 * leaf here has a matching row in `nav.ts`'s `ROUTE_META` — `routes.test.tsx`
 * checks the two tables agree.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<ShellLayout />}>
        <Route index element={<ViewPlaceholder title="Today" />} />
        <Route path="todos" element={<ViewPlaceholder title="Todos" />} />
        <Route path="revenue" element={<ViewPlaceholder title="Revenue" />} />
        <Route path="activity" element={<ViewPlaceholder title="Activity" />} />
        <Route path="companies" element={<Companies />} />
        <Route path="company/:id" element={<ViewPlaceholder title="Company" />} />
        <Route path="people" element={<ViewPlaceholder title="People" />} />
        <Route path="person/:id" element={<ViewPlaceholder title="Person" />} />
        <Route path="services" element={<ViewPlaceholder title="Catalogue" />} />
        <Route path="engagements" element={<ViewPlaceholder title="Engagements" />} />
        <Route path="workspace" element={<Outlet />}>
          <Route index element={<Navigate to="settings" replace />} />
          <Route path="settings" element={<ViewPlaceholder title="Settings" />} />
          <Route path="data" element={<ViewPlaceholder title="Data" />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
