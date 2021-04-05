import {
  ConcreteComponent,
  Data,
  validateComponentName,
  Component,
  createComponentInstance,
  setupComponent,
  finishComponentSetup
} from './component'
import { ComponentOptions } from './componentOptions'
import { ComponentPublicInstance } from './componentPublicInstance'
import { Directive, validateDirectiveName } from './directives'
import { RootRenderFunction } from './renderer'
import { InjectionKey } from './apiInject'
import { warn } from './warning'
import { createVNode, cloneVNode, VNode } from './vnode'
import { RootHydrateFunction } from './hydration'
import { devtoolsInitApp, devtoolsUnmountApp } from './devtools'
import { version } from '.'
import {
  isFunction,
  NO,
  isObject,
  warnDeprecation,
  DeprecationTypes
} from '@vue/shared'

export interface App<HostElement = any> {
  version: string
  config: AppConfig
  use(plugin: Plugin, ...options: any[]): this
  mixin(mixin: ComponentOptions): this
  component(name: string): Component | undefined
  component(name: string, component: Component): this
  directive(name: string): Directive | undefined
  directive(name: string, directive: Directive): this
  mount(
    rootContainer: HostElement | string,
    isHydrate?: boolean,
    isSVG?: boolean
  ): ComponentPublicInstance
  unmount(): void
  provide<T>(key: InjectionKey<T> | string, value: T): this

  // internal, but we need to expose these for the server-renderer and devtools
  _uid: number
  _component: ConcreteComponent
  _props: Data | null
  _container: HostElement | null
  _context: AppContext

  /**
   * @internal 2.x compat only
   */
  _createRoot?(options: ComponentOptions): ComponentPublicInstance
}

export type OptionMergeFunction = (
  to: unknown,
  from: unknown,
  instance: any,
  key: string
) => any

export interface AppConfig {
  // @private
  readonly isNativeTag?: (tag: string) => boolean

  performance: boolean
  optionMergeStrategies: Record<string, OptionMergeFunction>
  globalProperties: Record<string, any>
  isCustomElement: (tag: string) => boolean
  errorHandler?: (
    err: unknown,
    instance: ComponentPublicInstance | null,
    info: string
  ) => void
  warnHandler?: (
    msg: string,
    instance: ComponentPublicInstance | null,
    trace: string
  ) => void
}

export interface AppContext {
  app: App // for devtools
  config: AppConfig
  mixins: ComponentOptions[]
  components: Record<string, Component>
  directives: Record<string, Directive>
  provides: Record<string | symbol, any>
  /**
   * Flag for de-optimizing props normalization
   * @internal
   */
  deopt?: boolean
  /**
   * HMR only
   * @internal
   */
  reload?: () => void
}

type PluginInstallFunction = (app: App, ...options: any[]) => any

export type Plugin =
  | PluginInstallFunction & { install?: PluginInstallFunction }
  | {
      install: PluginInstallFunction
    }

export function createAppContext(): AppContext {
  return {
    app: null as any,
    config: {
      isNativeTag: NO,
      performance: false,
      globalProperties: {},
      optionMergeStrategies: {},
      isCustomElement: NO,
      errorHandler: undefined,
      warnHandler: undefined
    },
    mixins: [],
    components: {},
    directives: {},
    provides: Object.create(null)
  }
}

export type CreateAppFunction<HostElement> = (
  rootComponent: Component,
  rootProps?: Data | null
) => App<HostElement>

let uid = 0

export function createAppAPI<HostElement>(
  render: RootRenderFunction,
  hydrate?: RootHydrateFunction
): CreateAppFunction<HostElement> {
  return function createApp(rootComponent, rootProps = null) {
    if (rootProps != null && !isObject(rootProps)) {
      __DEV__ && warn(`root props passed to app.mount() must be an object.`)
      rootProps = null
    }

    const context = createAppContext()
    const installedPlugins = new Set()

    let isMounted = false

    const app: App = (context.app = {
      _uid: uid++,
      _component: rootComponent as ConcreteComponent,
      _props: rootProps,
      _container: null,
      _context: context,

      version,

      get config() {
        return context.config
      },

      set config(v) {
        if (__DEV__) {
          warn(
            `app.config cannot be replaced. Modify individual options instead.`
          )
        }
      },

      use(plugin: Plugin, ...options: any[]) {
        if (installedPlugins.has(plugin)) {
          __DEV__ && warn(`Plugin has already been applied to target app.`)
        } else if (plugin && isFunction(plugin.install)) {
          installedPlugins.add(plugin)
          plugin.install(app, ...options)
        } else if (isFunction(plugin)) {
          installedPlugins.add(plugin)
          plugin(app, ...options)
        } else if (__DEV__) {
          warn(
            `A plugin must either be a function or an object with an "install" ` +
              `function.`
          )
        }
        return app
      },

      mixin(mixin: ComponentOptions) {
        if (__FEATURE_OPTIONS_API__) {
          if (!context.mixins.includes(mixin)) {
            context.mixins.push(mixin)
            // global mixin with props/emits de-optimizes props/emits
            // normalization caching.
            if (mixin.props || mixin.emits) {
              context.deopt = true
            }
          } else if (__DEV__) {
            warn(
              'Mixin has already been applied to target app' +
                (mixin.name ? `: ${mixin.name}` : '')
            )
          }
        } else if (__DEV__) {
          warn('Mixins are only available in builds supporting Options API')
        }
        return app
      },

      component(name: string, component?: Component): any {
        if (__DEV__) {
          validateComponentName(name, context.config)
        }
        if (!component) {
          return context.components[name]
        }
        if (__DEV__ && context.components[name]) {
          warn(`Component "${name}" has already been registered in target app.`)
        }
        context.components[name] = component
        return app
      },

      directive(name: string, directive?: Directive) {
        if (__DEV__) {
          validateDirectiveName(name)
        }

        if (!directive) {
          return context.directives[name] as any
        }
        if (__DEV__ && context.directives[name]) {
          warn(`Directive "${name}" has already been registered in target app.`)
        }
        context.directives[name] = directive
        return app
      },

      mount(
        rootContainer: HostElement,
        isHydrate?: boolean,
        isSVG?: boolean
      ): any {
        if (!isMounted) {
          const vnode = createVNode(
            rootComponent as ConcreteComponent,
            rootProps
          )
          // store app context on the root VNode.
          // this will be set on the root instance on initial mount.
          vnode.appContext = context

          // HMR root reload
          if (__DEV__) {
            context.reload = () => {
              render(cloneVNode(vnode), rootContainer, isSVG)
            }
          }

          if (isHydrate && hydrate) {
            hydrate(vnode as VNode<Node, Element>, rootContainer as any)
          } else {
            render(vnode, rootContainer, isSVG)
          }
          isMounted = true
          app._container = rootContainer
          // for devtools and telemetry
          ;(rootContainer as any).__vue_app__ = app

          if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
            devtoolsInitApp(app, version)
          }

          return vnode.component!.proxy
        } else if (__DEV__) {
          warn(
            `App has already been mounted.\n` +
              `If you want to remount the same app, move your app creation logic ` +
              `into a factory function and create fresh app instances for each ` +
              `mount - e.g. \`const createMyApp = () => createApp(App)\``
          )
        }
      },

      unmount() {
        if (isMounted) {
          render(null, app._container)
          if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
            devtoolsUnmountApp(app)
          }
          delete app._container.__vue_app__
        } else if (__DEV__) {
          warn(`Cannot unmount an app that is not mounted.`)
        }
      },

      provide(key, value) {
        if (__DEV__ && (key as string | symbol) in context.provides) {
          warn(
            `App already provides property with key "${String(key)}". ` +
              `It will be overwritten with the new value.`
          )
        }
        // TypeScript doesn't allow symbols as index type
        // https://github.com/Microsoft/TypeScript/issues/24587
        context.provides[key as string] = value

        return app
      }
    })

    if (__COMPAT__) {
      /**
       * Vue 2 supports the behavior of creating a component instance but not
       * mounting it, which is no longer possible in Vue 3 - this internal
       * function simulates that behavior.
       */
      app._createRoot = options => {
        const vnode = createVNode(
          rootComponent as ConcreteComponent,
          options.propsData || null
        )
        vnode.appContext = context

        const hasNoRender =
          !isFunction(rootComponent) &&
          !rootComponent.render &&
          !rootComponent.template
        const emptyRender = () => {}

        // create root instance
        const instance = createComponentInstance(vnode, null, null)
        // suppress "missing render fn" warning since it can't be determined
        // until $mount is called
        if (hasNoRender) {
          instance.render = emptyRender
        }
        setupComponent(instance, __NODE_JS__)
        vnode.component = instance

        // $mount & $destroy
        // these are defined on ctx and picked up by the $mount/$destroy
        // public property getters on the instance proxy.
        // Note: the following assumes DOM environment since the compat build
        // only targets web. It essentially includes logic for app.mount from
        // both runtime-core AND runtime-dom.
        instance.ctx._compat_mount = (selectorOrEl: string | Element) => {
          if (isMounted) {
            __DEV__ && warn(`Root instance is already mounted.`)
            return
          }

          let container: Element
          if (typeof selectorOrEl === 'string') {
            // eslint-disable-next-line
            const result = document.querySelector(selectorOrEl)
            if (!result) {
              __DEV__ &&
                warn(
                  `Failed to mount root instance: selector "${selectorOrEl}" returned null.`
                )
              return
            }
            container = result
          } else {
            if (!selectorOrEl) {
              __DEV__ &&
                warn(
                  `Failed to mount root instance: invalid mount target ${selectorOrEl}.`
                )
              return
            }
            container = selectorOrEl
          }

          const isSVG = container instanceof SVGElement

          // HMR root reload
          if (__DEV__) {
            context.reload = () => {
              const cloned = cloneVNode(vnode)
              // compat mode will use instance if not reset to null
              cloned.component = null
              render(cloned, container, isSVG)
            }
          }

          // resolve in-DOM template if component did not provide render
          // and no setup/mixin render functions are provided (by checking
          // that the instance is still using the placeholder render fn)
          if (hasNoRender && instance.render === emptyRender) {
            // root directives check
            if (__DEV__) {
              for (let i = 0; i < container.attributes.length; i++) {
                const attr = container.attributes[i]
                if (attr.name !== 'v-cloak' && /^(v-|:|@)/.test(attr.name)) {
                  warnDeprecation(DeprecationTypes.DOM_TEMPLATE_MOUNT)
                  break
                }
              }
            }
            instance.render = null
            ;(rootComponent as ComponentOptions).template = container.innerHTML
            finishComponentSetup(instance, __NODE_JS__, true /* skip options */)
          }

          // clear content before mounting
          container.innerHTML = ''

          // TODO hydration
          render(vnode, container, isSVG)

          if (container instanceof Element) {
            container.removeAttribute('v-cloak')
            container.setAttribute('data-v-app', '')
          }

          isMounted = true
          app._container = container
          // for devtools and telemetry
          ;(container as any).__vue_app__ = app
          if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
            devtoolsInitApp(app, version)
          }

          return instance.proxy!
        }

        instance.ctx._compat_destroy = app.unmount

        return instance.proxy!
      }
    }

    return app
  }
}
