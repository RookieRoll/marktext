import { BrowserWindow, ipcMain } from 'electron'
import {
  isPerformanceMilestone,
  normalizePerformanceSamplePayload,
  type PerformanceSamplePayload
} from '@shared/performance'
import { mainPerformance } from '../performance'
import { createRendererSenderGuard } from './rendererSender'

const rendererSenderGuard = createRendererSenderGuard((sender) =>
  BrowserWindow.fromWebContents(sender)
)

const isPerformanceSamplePayload = (value: unknown): value is PerformanceSamplePayload => {
  if (!value || typeof value !== 'object') return false
  const payload = value as PerformanceSamplePayload
  if (payload.memory && typeof payload.memory !== 'object') return false
  if (payload.resources && typeof payload.resources !== 'object') return false
  if (payload.counters && typeof payload.counters !== 'object') return false
  return true
}

export const registerPerformanceHandlers = (): void => {
  ipcMain.on('mt::performance-mark', (event, milestone: unknown, payload: unknown): void => {
    rendererSenderGuard.assertTrustedRenderer(event)
    if (!isPerformanceMilestone(milestone)) return

    mainPerformance.mark(milestone)
    if (isPerformanceSamplePayload(payload)) {
      mainPerformance.sampleRenderer(normalizePerformanceSamplePayload(payload))
    }

    if (milestone === 'editor-interactive') {
      mainPerformance.sampleMain()
      void mainPerformance.writeReport()
    }
  })
}
