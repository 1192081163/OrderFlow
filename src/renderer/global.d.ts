import type { OrderOrganizerApi } from "../preload/preload.cjs";

export {};

declare global {
  interface Window {
    orderOrganizer?: OrderOrganizerApi;
  }
}
