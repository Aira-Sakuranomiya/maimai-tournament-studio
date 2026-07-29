import { inject, type InjectionKey } from 'vue'

export type ControlContext = Record<string, any>

export const controlContextKey: InjectionKey<ControlContext> = Symbol('control-console')

export function useControlContext() {
  const context = inject(controlContextKey)
  if (!context) throw new Error('Control console context is unavailable')
  return context
}
