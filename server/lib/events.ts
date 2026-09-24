import { EventEmitter } from 'node:events'

/* In-process domain events. Keeps modules decoupled (e.g. the WhatsApp manager
 * reacts to a property being deleted without the trash service importing it). */

interface Events {
  'property:deleted': [propertyId: string]
  'property:restored': [propertyId: string]
  'property:phoneChanged': [propertyId: string]
  'wa:outbox': [propertyId: string]
}

class Bus extends EventEmitter<Events> {}

export const events = new Bus()
events.setMaxListeners(50)
