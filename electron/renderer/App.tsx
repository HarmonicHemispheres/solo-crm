import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/query-client'

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div>
        <h1>Solo CRM</h1>
        <p>Scaffold running. Nothing user-visible ships from Phase 0.</p>
      </div>
    </QueryClientProvider>
  )
}

export default App
