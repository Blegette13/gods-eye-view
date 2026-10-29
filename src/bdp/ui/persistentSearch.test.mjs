import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPersistentLandSearch } from './persistentSearch.js';

function fakeDocument(withInput = true) {
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.parentElement = null;
      this.attrs = {};
      this.id = '';
      this.className = '';
      this.placeholder = '';
      this.textContent = '';
      this.htmlFor = '';
      this.classList = { contains: (name) => this.className.split(/\s+/).includes(name) };
    }
    append(...nodes) {
      for (const node of nodes) {
        if (node.parentElement) {
          node.parentElement.children = node.parentElement.children.filter((item) => item !== node);
        }
        node.parentElement = this;
        this.children.push(node);
      }
    }
    setAttribute(key, value) { this.attrs[key] = value; }
  }
  const body = new Element('body');
  const root = {
    body,
    createElement: (tag) => new Element(tag),
    getElementById(id) {
      const walk = (node) => node.id === id ? node
        : node.children.map(walk).find(Boolean);
      return walk(body);
    },
  };
  let search = null;
  let wrap = null;
  if (withInput) {
    const tray = root.createElement('div');
    tray.id = 'location-bar';
    wrap = root.createElement('div');
    wrap.className = 'location-search-wrap';
    search = root.createElement('input');
    search.id = 'location-search';
    wrap.append(search);
    tray.append(wrap);
    body.append(tray);
  }
  return { root, search, wrap };
}

test('promotes the same native input, never clones it, and is idempotent', () => {
  const { root, search, wrap } = fakeDocument();
  const oldInput = root.getElementById('location-search');
  assert.equal(mountPersistentLandSearch(root), true);
  const bar = root.getElementById('land-search-bar');
  assert.ok(bar);
  assert.equal(root.getElementById('location-search'), oldInput);
  assert.equal(search.parentElement, wrap);
  assert.equal(wrap.parentElement, bar);
  assert.equal(bar.attrs.role, 'search');
  assert.equal(search.attrs['aria-describedby'], 'land-search-hint land-search-status');
  assert.equal(root.getElementById('land-search-status').attrs.role, 'status');
  const hint = root.getElementById('land-search-hint').textContent;
  assert.match(hint, /Travis parcel: \[parcel ID\]/);
  assert.match(hint, /Travis owner: \[name\]/);
  assert.doesNotMatch(hint, /302959/, 'search example must not point to a specific property');
  assert.equal(mountPersistentLandSearch(root), true);
  assert.equal(root.body.children.filter((node) => node.id === 'land-search-bar').length, 1);
});

test('cannot mount without the original search input', () => {
  const { root } = fakeDocument(false);
  assert.equal(mountPersistentLandSearch(root), false);
  assert.equal(root.getElementById('land-search-bar'), undefined);
});
