import { useLocation } from 'react-router'
import { getBreadcrumb } from '../../nav'

/** `<span class="crumb">` from the mockup — hidden below 900px (Topbar.css)
 * where the topbar has no room for it once the search button grows to fill
 * the freed space. */
export function Breadcrumb() {
  const location = useLocation()
  return <span className="crumb">{getBreadcrumb(location.pathname)}</span>
}
