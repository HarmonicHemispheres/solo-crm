import { Navigate, Outlet, Route, Routes } from 'react-router'
import { ShellLayout } from './components/shell/Shell'
import { Activity } from './views/Activity'
import { Companies } from './views/Companies'
import { CompanyDetail } from './views/CompanyDetail'
import { People } from './views/People'
import { PersonDetail } from './views/PersonDetail'
import { Engagements } from './views/Engagements'
import { Todos } from './views/Todos'
import { WorkspaceSettings } from './views/WorkspaceSettings'
import { WorkspaceData } from './views/WorkspaceData'

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
        <Route path="todos" element={<Todos />} />
        <Route path="revenue" element={<ViewPlaceholder title="Revenue" />} />
        <Route path="activity" element={<Activity />} />
        <Route path="companies" element={<Companies />} />
        <Route path="company/:id" element={<CompanyDetail />} />
        <Route path="people" element={<People />} />
        <Route path="person/:id" element={<PersonDetail />} />
        <Route path="offerings" element={<ViewPlaceholder title="Offerings" />} />
        <Route path="engagements" element={<Engagements />} />
        <Route path="workspace" element={<Outlet />}>
          <Route index element={<Navigate to="settings" replace />} />
          <Route path="settings" element={<WorkspaceSettings />} />
          <Route path="data" element={<WorkspaceData />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
