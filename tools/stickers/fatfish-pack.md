# 大肥鱼表情包・角色卡与场景清单

参考图：用户提供的清晰原图（鲸鱼耳鳍 + 鲸鱼尾巴 + 围裙小鲸鱼刺绣的蓝发女仆）。
用途：哦鲸鲸自己用的表情包，定稿后经 `add_custom_face` 收藏、`qq_send_sticker` 发送。

## 角色提示词（生图共用前缀）

```text
Sticker-style chibi anime illustration of a cute chubby girl with a big head and small body.
Character details: long wavy vivid blue hair with lighter blue highlights; big sparkling blue eyes;
white frilly maid headdress; two blue whale-fin ears on the sides of her head with pale blue inner sides;
a large navy-blue whale tail fin behind her; navy-blue short-sleeve maid dress with a white frilly apron,
white lace trim, small blue bows on the skirt, a tiny blue whale embroidery on the apron,
blue ribbon bow at the collar; white socks and dark navy mary-jane shoes.
Clean thick lineart, soft cel shading, bright pastel colors, plain pure white background,
full body, centered composition with generous margins, no text, no speech bubble, no watermark,
no background objects besides the scene-specific items.
```

中文要点：Q 版大头小身；深蓝长卷发带浅蓝高光；白色荷叶边女仆头饰；**头两侧鲸鱼鳍状耳**、身后**深蓝鲸尾**；藏蓝女仆裙 + 白色花边围裙，围裙上有**小蓝鲸刺绣**，裙摆有小蓝蝴蝶结；白袜深蓝玛丽珍鞋。

## 场景与配文

| # | 文件 | 场景 | 配文 | 场景补句（接在角色提示词后） |
|---|------|------|------|------------------------------|
| 1 | 01-happy | 开心 | 哦鲸鲸！ | Pose: jumping joyfully with both arms raised high, huge open-mouth smile, tiny sparkles around her. |
| 2 | 02-cry | 哭哭 | 要鲸落了… | Pose: sitting on the floor hugging her knees, big glistening teary eyes, streams of tears, pouting lips. |
| 3 | 03-speechless | 无语 | 哦。 | Pose: standing with arms crossed, half-lidded deadpan eyes glancing sideways, small pout, one blue sweat drop. |
| 4 | 04-headpat | 被摸头 | 摸头收费，一次五块 | Pose: a human hand from above gently patting her head; she is blushing, eyes closed in a happy smile. |
| 5 | 05-holding-cat | 抱猫 | 捡到一只猫，归我了 | Pose: happily hugging a chubby white-and-orange cat, the cat looks slightly squished with a grumpy face. |
| 6 | 06-in-pot | 蹲锅里 | 已熟，可捞 | Pose: sitting inside a large stainless-steel cooking pot with knees up, steam rising, awkward smile. |

## 产出文件

- 底图（无字）：`tools/stickers/pack/0N-*.png`
- 成品（压字）：`tools/stickers/pack/0N-*-captioned.png`
- 上传版（512px）：`tools/stickers/pack/upload/`

> 生成的图片属本地个人素材且体积较大，`.gitignore` 已排除 `tools/stickers/pack/` 与 `samples/`；仓库只保留本角色卡、加字脚本与上传脚本，图片按本文流程可重新生成。

## 制作流程

1. 生图工具按「角色提示词 + 场景补句」出 1024×1024 底图。
2. 裁掉右下角 AI 水印（PowerShell System.Drawing，裁 960×960）。
3. `python tools/stickers/caption_sticker.py 底图 "配文" 输出`（微软雅黑 Bold，白字黑描边，贴底居中，字号自适应）。
4. 用户过目定稿 → `add_custom_face`（base64）传进她的 QQ 收藏 → `qq_send_sticker` 以真表情发送。

## 注意

- 文字模型生成的角色一致性约八成：发色、服装、鲸耳鲸尾都能对上，脸型和细节会有漂移。要更稳需参考图驱动的生图模型，或本地 LoRA。
- 收藏表情有容量上限，定稿后再大批量上传，不要每次现画现传。
