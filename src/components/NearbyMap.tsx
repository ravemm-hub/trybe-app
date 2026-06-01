import { useRef, useEffect, useMemo } from 'react'
import { WebView } from 'react-native-webview'

export type MapUser = { id: string; name: string; lat: number; lon: number; avatar?: string | null }

// Two modes:
//   - `onSelection` → multi-select (group-add flow). Tap toggles checkmarks.
//   - `onTapUser`   → single-tap (radar flow). Tap a pin → callback fires with the user id.
//
// `hideSelectionUI` hides the "select everyone in circle" CTA + counter for the
// single-tap mode (Radar) where it's not useful.

const HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
 html,body,#map{height:100%;margin:0;padding:0}
 .bar{position:absolute;top:8px;left:8px;right:8px;z-index:1000;display:flex;gap:6px}
 .bar input{flex:1;padding:9px 12px;border-radius:10px;border:1px solid #ccc;font-size:14px;outline:none}
 .bar button{padding:9px 14px;border-radius:10px;border:none;background:#6C63FF;color:#fff;font-weight:700}
 .sel{position:absolute;bottom:74px;left:8px;z-index:1000;background:rgba(0,0,0,0.65);color:#fff;padding:6px 12px;border-radius:20px;font:600 13px sans-serif}
 .cta{position:absolute;bottom:16px;left:8px;right:8px;z-index:1000;background:#6C63FF;color:#fff;border:none;padding:13px;border-radius:14px;font:700 15px sans-serif}
 .tap-pin{background:#6C63FF;color:#fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-weight:700;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.25);font-size:18px}
</style></head><body>
<div class="bar"><input id="q" placeholder="Search city or address..."/><button onclick="doSearch()">Go</button></div>
<div id="map"></div>
<div class="sel" id="sel" style="display:__SHOW_SEL__">0 selected</div>
<button class="cta" id="cta" onclick="selectInCircle()" style="display:__SHOW_SEL__">◯ Select everyone in the circle</button>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
 var DATA = __DATA__;
 var MODE = "__MODE__";  // 'select' or 'tap'
 var map = L.map('map',{zoomControl:false}).setView([DATA.lat,DATA.lon], 13);
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
 L.circleMarker([DATA.lat,DATA.lon],{radius:7,color:'#00BFA6',fillColor:'#00BFA6',fillOpacity:1}).addTo(map);
 var radius = DATA.radius||5000;
 var circle = L.circle([DATA.lat,DATA.lon],{radius:radius,color:'#6C63FF',weight:2,fillColor:'#6C63FF',fillOpacity:0.08}).addTo(map);
 map.on('move',function(){circle.setLatLng(map.getCenter());});
 var selected={}, markers={};
 function paint(id){var m=markers[id];if(m)m.setOpacity(selected[id]?1:0.55);}
 function post(){var ids=Object.keys(selected).filter(function(k){return selected[k];});document.getElementById('sel').innerText=ids.length+' selected';if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({type:'selection',ids:ids}));}
 function toggle(id){selected[id]=!selected[id];paint(id);post();}
 function tap(id){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({type:'tap',id:id}));}
 function mk(u){
   var icon = L.divIcon({ html: '<div class="tap-pin">'+(u.avatar||'👤')+'</div>', iconSize: [36,36], className: '' });
   var m=L.marker([u.lat,u.lon], { icon: icon }).addTo(map);
   m.bindTooltip(u.name||'User');
   m.on('click', function(){ if (MODE === 'tap') tap(u.id); else toggle(u.id); });
   markers[u.id]=m;
   if (MODE === 'select') paint(u.id);
 }
 function setRadius(r){radius=r;circle.setRadius(r);}
 function selectInCircle(){var c=map.getCenter();DATA.users.forEach(function(u){var d=map.distance([u.lat,u.lon],c);selected[u.id]=(d<=radius);paint(u.id);});post();}
 function doSearch(){var q=document.getElementById('q').value;if(!q)return;fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(q)).then(function(r){return r.json();}).then(function(j){if(j&&j[0])map.setView([parseFloat(j[0].lat),parseFloat(j[0].lon)],13);}).catch(function(){});}
 DATA.users.forEach(mk);
</script></body></html>`

export function NearbyMap({ center, users, radiusM, onSelection, onTapUser, hideSelectionUI }: {
  center: { lat: number; lon: number }
  users: MapUser[]
  radiusM: number
  onSelection?: (ids: string[]) => void
  onTapUser?: (id: string) => void
  hideSelectionUI?: boolean
}) {
  const ref = useRef<WebView>(null)
  const usersKey = JSON.stringify(users)
  const mode = onTapUser ? 'tap' : 'select'
  const showSel = (mode === 'select' && !hideSelectionUI) ? 'block' : 'none'
  const html = useMemo(
    () => HTML
      .replace('__DATA__', JSON.stringify({ lat: center.lat, lon: center.lon, users, radius: radiusM }))
      .replace(/__MODE__/g, mode)
      .replace(/__SHOW_SEL__/g, showSel),
    [center.lat, center.lon, usersKey, mode, showSel],
  )
  useEffect(() => { ref.current?.injectJavaScript(`setRadius(${radiusM}); true;`) }, [radiusM])
  return (
    <WebView
      ref={ref}
      originWhitelist={['*']}
      source={{ html }}
      onMessage={(e) => {
        try {
          const d = JSON.parse(e.nativeEvent.data)
          if (d.type === 'selection' && onSelection) onSelection(d.ids || [])
          else if (d.type === 'tap' && onTapUser && d.id) onTapUser(d.id)
        } catch {}
      }}
      style={{ flex: 1 }}
    />
  )
}
