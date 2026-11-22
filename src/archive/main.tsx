import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import ArchiveApp, { ArchiveMissing } from './ArchiveApp'
import { createArchiveRepository, type ArchiveData } from './archiveRepository'

const data = (window as unknown as { ATHAR_ARCHIVE?: ArchiveData }).ATHAR_ARCHIVE
const root = createRoot(document.getElementById('root')!)
if (!data || !Array.isArray(data.versions)) root.render(<ArchiveMissing />)
else root.render(<StrictMode><ArchiveApp data={data} repository={createArchiveRepository(data)} /></StrictMode>)
