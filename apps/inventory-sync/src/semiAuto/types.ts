export type SemiAutoExecutionTaskCategory =
  | 'retail_primary_device_full_closure'
  | 'retail_original_link_spec_recheck'
  | 'retail_full_capture'
  | 'retail_price_verification'
  | 'retail_link_backfill'
  | 'gray_channel_capture'
  | 'distributor_quote_capture'
  | 'zhidiantong_serial_backfill'
  | 'warranty_backfill'

export type SemiAutoExecutionTarget = {
  skuKey?: string
  pnMtm?: string
  productName?: string
  category?: string
  currentStock?: number
  source?: string
  url?: string
  status?: string
  note?: string
  quantity?: number
  nextAction?: string
  sourceOrder?: string[]
  displayBlocked?: boolean
  priorityReason?: string
}

export type SemiAutoExecutionTask = {
  id: string
  title: string
  category: SemiAutoExecutionTaskCategory
  requiresComputerUse: boolean
  status: 'pending' | 'blocked' | 'completed'
  executionOutcome?: 'real_completed' | 'executed_not_closed' | 'blocked_missing_input' | 'blocked_page_risk'
  lastExecutedAt?: string
  manualActionRequired?: boolean
  blockingReason?: string
  reason: string
  timeWindow: string
  inputs: string[]
  evidencePaths: string[]
  instructions: string[]
  targets: SemiAutoExecutionTarget[]
}

export type SemiAutoExecutionPlan = {
  generatedAt: string
  triggerTaskName?: string
  summary: {
    pendingTaskCount: number
    retailFullCaptureCount: number
    retailPrimaryDeviceFullClosureCount?: number
    retailOriginalLinkSpecRecheckCount?: number
    retailPriceVerificationCount: number
    retailLinkBackfillCount: number
    newStockPriorityCount?: number
    newStockImmediateClosureCount?: number
    frontendBlankPriceCount: number
    zhidiantongSerialGapCount: number
    grayChannelBlockedCount: number
    distributorBlockedCount: number
    warrantyGapCount: number
  }
  tasks: SemiAutoExecutionTask[]
}
