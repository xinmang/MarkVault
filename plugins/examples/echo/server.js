// 依赖由作者预先打包；activate 收到的 SDK 是唯一宿主能力入口。
export function activate(sdk) {
  return {
    async invoke(tool, args) {
      if (tool !== 'echo') throw new Error('未知工具');
      await sdk.storage.set('last', args.text);
      return { text: args.text, previous: await sdk.storage.get('last') };
    },
    dispose() {},
  };
}
