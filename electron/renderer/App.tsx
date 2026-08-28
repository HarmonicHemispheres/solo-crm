import { QueryClientProvider } from '@tanstack/react-query'
import { HashRouter } from 'react-router'
import { queryClient } from './lib/query-client'
import { LayerManager } from './components/shell/LayerManager'
import { AppRoutes } from './routes'

// HashRouter, not BrowserRouter: the packaged app loads a single
// `file://.../index.html` via `mainWindow.loadFile` (electron/main/index.ts)
// with no server behind it to resolve an arbitrary deep path on a real
// reload (devtools reload, `mainWindow.reload()`) — a `#/companies` URL
// never asks the filesystem for a path that doesn't exist, where a
// pushState-based `/companies` would.
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <LayerManager>
          <AppRoutes />
        </LayerManager>
      </HashRouter>
    </QueryClientProvider>
  )
}

export default App
