import { getInitialState, getWindowType, setMarktextRuntime } from './platform/runtime'
import { createApp, reactive, type App } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import bootstrapRenderer from './bootstrap'
import bus from './bus'
import { markRendererPerformance } from './platform/performance'
import axios from './axios'
import pinia from './store'
import { usePreferencesStore } from './store/preferences'
import './assets/symbolIcon'

// Register only the Element Plus components used by the renderer. The package-level
// installer imports every component and plugin (including Message, Loading, picker,
// upload, and table-v2), which needlessly parses those modules during startup.
import { ElAutocomplete } from 'element-plus/es/components/autocomplete/index'
import { ElButton } from 'element-plus/es/components/button/index'
import { ElCol } from 'element-plus/es/components/col/index'
import { ElDialog } from 'element-plus/es/components/dialog/index'
import { ElForm } from 'element-plus/es/components/form/index'
import { ElIcon } from 'element-plus/es/components/icon/index'
import { ElInput } from 'element-plus/es/components/input/index'
import { ElInputNumber } from 'element-plus/es/components/input-number/index'
import { ElRadio } from 'element-plus/es/components/radio/index'
import { ElRow } from 'element-plus/es/components/row/index'
import { ElSelect } from 'element-plus/es/components/select/index'
import { ElSlider } from 'element-plus/es/components/slider/index'
import { ElSwitch } from 'element-plus/es/components/switch/index'
import { ElTable } from 'element-plus/es/components/table/index'
import { ElTabs } from 'element-plus/es/components/tabs/index'
import { ElTooltip } from 'element-plus/es/components/tooltip/index'
import { ElTree } from 'element-plus/es/components/tree/index'
import { provideGlobalConfig } from 'element-plus/es/components/config-provider/index'
import type { Language } from 'element-plus/es/locale'
import elDe from 'element-plus/es/locale/lang/de'
import elEn from 'element-plus/es/locale/lang/en'
import elEs from 'element-plus/es/locale/lang/es'
import elFr from 'element-plus/es/locale/lang/fr'
import elJa from 'element-plus/es/locale/lang/ja'
import elKo from 'element-plus/es/locale/lang/ko'
import elPt from 'element-plus/es/locale/lang/pt'
import elTr from 'element-plus/es/locale/lang/tr'
import elZhCn from 'element-plus/es/locale/lang/zh-cn'
import elZhTw from 'element-plus/es/locale/lang/zh-tw'

// Keep the component CSS boundary explicit. Each entry imports its required
// base/overlay/popper styles without pulling in the complete theme-chalk bundle.
import 'element-plus/es/components/autocomplete/style/css'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/col/style/css'
import 'element-plus/es/components/dialog/style/css'
import 'element-plus/es/components/form/style/css'
import 'element-plus/es/components/icon/style/css'
import 'element-plus/es/components/input/style/css'
import 'element-plus/es/components/input-number/style/css'
import 'element-plus/es/components/radio/style/css'
import 'element-plus/es/components/row/style/css'
import 'element-plus/es/components/select/style/css'
import 'element-plus/es/components/slider/style/css'
import 'element-plus/es/components/switch/style/css'
import 'element-plus/es/components/table/style/css'
import 'element-plus/es/components/tabs/style/css'
import 'element-plus/es/components/tooltip/style/css'
import 'element-plus/es/components/tree/style/css'

// I18n translation system
import i18nPlugin, { requestCurrentLanguage, setLanguage } from './i18n'

// something is wrong here! \/
import services from './services/index'
import routes from './router'
import Main from './Main.vue'

import './assets/styles/index.css'
import './assets/styles/printService.css'

// -----------------------------------------------

markRendererPerformance('renderer-start')

const startRenderer = async (): Promise<void> => {
  setMarktextRuntime({})
  bootstrapRenderer()

  // Seed the renderer store from the same minimal Main snapshot before any
  // page renders. The later full preference IPC only fills in the remainder.
  const initialState = getInitialState()
  if (initialState) {
    usePreferencesStore(pinia).SET_USER_PREFERENCE(initialState)
  }

  // -----------------------------------------------
  // Be careful when changing code before this line!

  // Create Vue app
  const app: App<Element> = createApp(Main)

  // Configure the same global locale as the full installer, without installing
  // unused Element Plus components and global services.
  const elementPlusLocales: Record<string, Language> = {
    de: elDe,
    en: elEn,
    es: elEs,
    fr: elFr,
    ja: elJa,
    ko: elKo,
    pt: elPt,
    tr: elTr,
    'zh-CN': elZhCn,
    'zh-TW': elZhTw
  }
  const elementPlusConfig: { locale: Language } = reactive({ locale: elementPlusLocales.en })
  provideGlobalConfig(elementPlusConfig, app, true)
  // Keep Element Plus internal component text in sync with the app language.
  bus.on('language-changed', (locale) => {
    const next = elementPlusLocales[String(locale)]
    if (next) elementPlusConfig.locale = next
  })

  const elementPlusComponents = [
    ElAutocomplete,
    ElButton,
    ElCol,
    ElDialog,
    ElForm,
    ElIcon,
    ElInput,
    ElInputNumber,
    ElRadio,
    ElRow,
    ElSelect,
    ElSlider,
    ElSwitch,
    ElTable,
    ElTabs,
    ElTooltip,
    ElTree
  ]
  for (const component of elementPlusComponents) app.use(component)

  const envType = getWindowType()

  const router = createRouter({
    history: createWebHashHistory(),
    // it seems like something might have changed in vue-router? it uses the full "file path" instead of
    // links like /editor if we use the old createWebHistory()
    routes: routes(envType)
  })

  app.use(router)
  app.use(pinia)
  app.use(i18nPlugin)

  // Configure axios globally
  app.config.globalProperties.$http = axios

  // Register services globally
  ;(services as unknown as Array<Record<string, unknown> & { name: string }>).forEach((s) => {
    app.config.globalProperties['$' + s.name] = s[s.name]
  })

  app.mount('#app')

  // Mount the app before loading the resolved locale. Blocking mount on the
  // async translation load races Main's did-finish-load bootstrap message:
  // the editor page registers its listeners after Main has already sent
  // `mt::bootstrap-editor`, so the sidebar and documents never initialize.
  // Main seeds the language preference through the URL snapshot; loading it
  // after mount keeps startup event ordering intact.
  const initialLanguage = getInitialState()?.language
  if (initialLanguage) {
    void setLanguage(initialLanguage).catch((error) => {
      // Keep the existing English fallback when a locale cannot be loaded.
      console.warn('Failed to load initial language:', initialLanguage, error)
    })
  } else {
    requestCurrentLanguage()
  }

  requestAnimationFrame(() => {
    markRendererPerformance('first-paint')
  })
}

void startRenderer()
