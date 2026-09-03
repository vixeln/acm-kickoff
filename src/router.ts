import { createRouter, createWebHistory } from 'vue-router'

import HostView from './views/HostView.vue'
import LoginView from './views/LoginView.vue'
import PlayView from './views/PlayView.vue'
import DisplayView from './views/DisplayView.vue'

/**
 * Determines the default landing experience from the browser-visible hostname.
 *
 * A host opening localhost goes directly to its controls. Every remotely addressed browser is
 * treated as a player by default, while authenticated hosts can still navigate to `/host`.
 */
function isHostDevice() {
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
}

export default createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: () => (isHostDevice() ? '/host' : '/login'),
    },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/host', name: 'host', component: HostView },
    { path: '/play', name: 'play', component: PlayView },
    { path: '/display/:room', name: 'display', component: DisplayView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
