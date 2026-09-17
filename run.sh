#!/bin/bash
# Diet Dash — serve locally so you can open it in a browser or test on your phone.
# Usage: ./run.sh            -> serves on http://localhost:8788 and opens it
#        ./run.sh --lan      -> also prints the URL to open on your phone (same Wi-Fi)
cd "$(dirname "$0")"
PORT=8788
if [ "$1" == "--lan" ]; then
  IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
  echo "On your phone (same Wi-Fi):  http://$IP:$PORT"
  echo "  (Note: iOS 'Add to Home Screen' as a full PWA needs HTTPS — for that, deploy to Vercel. See README.)"
fi
echo "Local:  http://localhost:$PORT"
( sleep 1; open "http://localhost:$PORT" ) &
python3 -m http.server $PORT
