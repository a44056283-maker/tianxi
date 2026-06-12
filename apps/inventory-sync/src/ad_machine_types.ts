/**
 * Shared types for ad-machine system
 * 2026-06-10
 */

export type MediaType = 'image' | 'video'
export type ContentStatus = 'active' | 'inactive' | 'archived'
export type DeviceStatus = 'online' | 'offline'
export type ScreenStatus = 'on' | 'off' | 'error'

export interface AdContent {
  id: string
  title: string
  media_url: string
  media_type: MediaType
  duration_sec: number
  priority: number
  valid_from: string
  valid_to: string
  status: ContentStatus
  created_at: string
  updated_at: string
}

export interface AdSchedule {
  id: string
  content_id: string
  shop_id: string
  start_time: string
  end_time: string
  repeat_rule: string
  status: string
  created_at: string
  updated_at: string
}

export interface AdDevice {
  id: string
  device_id: string
  shop_id: string
  name: string
  status: DeviceStatus
  current_content_id: string | null
  screen_status: ScreenStatus
  last_heartbeat_at: string | null
  created_at: string
  updated_at: string
}

export interface AdStats {
  ok: boolean
  total_plays: number
  completed_plays: number
  avg_duration_sec: number
  interrupted_plays: number
  interrupt_rate_percent: number
  active_devices: number
  total_active_content: number
}

export interface PlaybackLog {
  id: string
  device_id: string
  content_id: string
  started_at: string
  finished_at: string | null
  duration_sec: number | null
  completed: boolean
  interrupt_reason: string
}
