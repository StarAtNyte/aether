/**
 * React access to the page-wide AI connection state.
 */
import { useStore } from 'zustand';
import { aiConnection } from './connection';
/** Select from the AI connection state (re-renders only when the selection changes). */
export function useAi(selector) {
    return useStore(aiConnection().store, selector);
}
/** Human label + tone for the bridge state badge. */
export function bridgeBadge(state) {
    switch (state) {
        case 'ready':
            return { text: 'Connected', tone: 'ok' };
        case 'checking':
            return { text: 'Checking…', tone: 'quiet' };
        case 'not_logged_in':
            return { text: 'Not signed in', tone: 'warn' };
        case 'offline':
            return { text: 'Bridge offline', tone: 'bad' };
        case 'error':
            return { text: 'Error', tone: 'bad' };
        case 'unpaired':
            return { text: 'Not paired', tone: 'quiet' };
    }
}
/** Human label + tone for the local AI badge. */
export function localBadge(state) {
    switch (state) {
        case 'ready':
            return { text: 'Ready', tone: 'ok' };
        case 'checking':
            return { text: 'Checking…', tone: 'quiet' };
        case 'not_logged_in':
            return { text: 'Not signed in', tone: 'warn' };
        case 'error':
            return { text: 'Error', tone: 'bad' };
        case 'off':
            return { text: 'Run locally', tone: 'quiet' };
    }
}
