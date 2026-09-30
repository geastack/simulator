export default {
    base: '/preview/',
    resolve: { alias: { '@app': "./components/App.tsx" } },
    plugins: [{ name: 'gea-plugin', transform() { throw new Error('duplicate Gea transform') } }, { name: 'web-config-test', transformIndexHtml(html) { return html.replace('Custom HTML', 'Configured HTML') } }]
  }