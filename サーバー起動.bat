@echo off
rem 旅のしおり ローカルサーバー起動
rem ダブルクリックで起動し、ブラウザで http://localhost:8934 を開いてください。
rem このウィンドウを閉じるとサーバーも止まります。
cd /d "%~dp0"
echo 旅のしおりサーバーを起動します: http://localhost:8934
start "" http://localhost:8934
python -m http.server 8934
pause
