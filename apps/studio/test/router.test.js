import { describe, expect, it } from 'vitest';
import { isHomeRoute, parseRoute, routeHash } from '../src/lib/router';
describe('router', () => {
    it('parses the home sections', () => {
        expect(parseRoute('')).toEqual({ name: 'home' });
        expect(parseRoute('#/')).toEqual({ name: 'home' });
        expect(parseRoute('#/templates')).toEqual({ name: 'templates' });
        expect(parseRoute('#/projects')).toEqual({ name: 'projects' });
        expect(parseRoute('#/published')).toEqual({ name: 'published' });
        expect(parseRoute('#/docs')).toEqual({ name: 'docs' });
        expect(parseRoute('projects')).toEqual({ name: 'projects' });
    });
    it('parses editor and new routes with strict ids', () => {
        expect(parseRoute('#/p/abc123def456')).toEqual({ name: 'editor', id: 'abc123def456' });
        expect(parseRoute('#/new')).toEqual({ name: 'new', template: null });
        expect(parseRoute('#/new/lakeside-camp')).toEqual({ name: 'new', template: 'lakeside-camp' });
    });
    it('falls back to home for anything malformed or hostile', () => {
        for (const bad of ['#/p/', '#/p/UPPER12345', '#/p/short', '#/p/../../etc', '#/p/abc123def456/extra', '#/new/<script>', '#/new/a--b', '#/unknown', '#/projects/x', `#/p/${'a'.repeat(40)}`, `#/${'x'.repeat(300)}`]) {
            expect(parseRoute(bad)).toEqual({ name: 'home' });
        }
        expect(parseRoute(42)).toEqual({ name: 'home' });
    });
    it('ignores a query suffix and round-trips every route', () => {
        expect(parseRoute('#/templates?x=1')).toEqual({ name: 'templates' });
        const routes = [{ name: 'home' }, { name: 'templates' }, { name: 'projects' }, { name: 'published' }, { name: 'docs' }, { name: 'editor', id: 'k3j4h5g6f7d8' }, { name: 'new', template: null }, { name: 'new', template: 'coin-island' }];
        for (const r of routes)
            expect(parseRoute(routeHash(r))).toEqual(r);
    });
    it('classifies home routes', () => {
        expect(isHomeRoute({ name: 'docs' })).toBe(true);
        expect(isHomeRoute({ name: 'editor', id: 'k3j4h5g6f7d8' })).toBe(false);
        expect(isHomeRoute({ name: 'new', template: null })).toBe(false);
    });
});
