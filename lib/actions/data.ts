"use server";

import {
    getUserAddons as getUserAddonsAction,
    addAddon as addAddonAction,
    removeAddon as removeAddonAction,
    toggleAddon as toggleAddonAction,
    toggleAddonCatalogs as toggleAddonCatalogsAction,
    updateAddonOrders as updateAddonOrdersAction,
} from "./addons";
import type { CreateAddon } from "@/lib/types";

export async function getUserAddons() {
    return getUserAddonsAction();
}

export async function addAddon(data: CreateAddon) {
    return addAddonAction(data);
}

export async function removeAddon(addonId: string) {
    return removeAddonAction(addonId);
}

export async function toggleAddon(addonId: string, enabled: boolean) {
    return toggleAddonAction(addonId, enabled);
}

export async function toggleAddonCatalogs(addonId: string, showCatalogs: boolean) {
    return toggleAddonCatalogsAction(addonId, showCatalogs);
}

export async function updateAddonOrders(updates: { id: string; order: number }[]) {
    return updateAddonOrdersAction(updates);
}
