import type { OrderOrganizerApi } from "../preload/preload.js";

export {};

declare global {
  interface Window {
    orderOrganizer: OrderOrganizerApi;
  }
}
