import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import SupportEmail from './SupportEmail.vue';
import './brand.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('SupportEmail', SupportEmail);
  },
} satisfies Theme;
