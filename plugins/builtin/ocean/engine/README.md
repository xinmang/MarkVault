# 海洋彩蛋

鱼群模拟和字符渲染改编自 [ascii-sharks](https://github.com/stackedlol/ascii-sharks)，采用 MIT 许可证。原始版权声明保存在本目录的 `LICENSE`，发布产物同时包含 `public/licenses/ascii-sharks.txt`。

`world.ts`、`renderer.ts`、`species.ts` 和 `math.ts` 保留上游的模拟结构及说明。适配内容包括透明画布、浅色主题配色、海豚外形、移除原首页标题的避让区域，以及严格索引检查所需的类型断言。

`engine.ts` 负责与页面连接：首次按屏幕宽度选择动物组合，限制绘制到每秒 30 帧，隐藏页面或关闭动效时暂停，并在销毁时释放事件监听器和动画循环。主题变化通过 `setOptions` 更新配色，不重建模拟。

`state.ts` 按海洋样式缓存 `WorldSnapshot`：站内切页从内存恢复，刷新从当前标签页的 `sessionStorage` 恢复。快照保留模拟时间、大小鱼的运动参数、身体节点、捕食目标和再生计时；空间索引在下一步模拟中重新建立，旧页面指针状态不恢复。只在卸载、`pagehide` 和页面隐藏时写入，缓存损坏或浏览器拒绝存储时安全回退。样式与账号／浏览器保存方式见 `docs/ocean-and-motion-settings.md`。
