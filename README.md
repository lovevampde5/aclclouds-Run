# aclclouds-Run     
ACL_EMAIL=   邮箱   
ACL_PASSWORD=   密码   
ACL_SERVER_ID=   服务器 ID   
TG_BOT_TOKEN     
TG_CHAT_ID

处理"Anti-bot confirmation"验证框

加一个 handleAntiBotModal() 函数：模拟鼠标移动、点击复选框、等待验证通过、再检测弹窗是否关闭。    
检测页面文本里是否出现 Anti-bot confirmation 或 I am not a robot（判断弹窗是否真的弹出，避免每次都白等）    
如果弹窗存在，定位到 I am not a robot 复选框，模拟鼠标移动+点击（和你登录时处理验证码的手法一致）    
点击后等待 3~5 秒，让网页自身的验证逻辑跑完    
顺手截一张 debug-antibot.png，方便你后续排查     
再尝试找一遍 Confirm/Verify/Submit 等按钮点掉（有些验证框勾选后还会多一步确认，防止漏掉）    
最后轮询最多 15 秒，确认 "Anti-bot confirmation" 文案从页面消失，才算验证通过    
<img width="427" height="227" alt="41" src="https://github.com/user-attachments/assets/4ab88e9b-1ebd-41db-a21a-f80cf5307114" />

