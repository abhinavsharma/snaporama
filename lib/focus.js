const tabs = require("tabs");
const utils = require("./utils");
const {Cu, Ci} = require("chrome");

let Svcs = {}
Cu.import("resource://gre/modules/Services.jsm", Svcs);
let Places = {};
Cu.import("resource://gre/modules/PlacesUtils.jsm", Places);
Places.PlacesUtils.history.QueryInterface(Ci.nsPIPlacesDatabase);


function TabFocus() {
  let me = this;
}

TabFocus.prototype.getRevHostFromURI = function(uri) {
  let me = this;
  let m = uri.match(/https{0,1}:\/\/([^\/]+).*/);
  if (!m || m.length < 2)
    return null;
  return m[1].split('').reverse().join('') + '.';
}


TabFocus.prototype.getParentsFromHIDs = function(hids) {
  // select these ids, join itself om from visits, then recuse on from_visits
  let globalPlaces = {};
  function getParentsHelper(currentList) {
    console.log(JSON.stringify(currentList));
    if (currentList.length == 0)
      return;

    let recurseList = [];
    // TODO: fix this
    let params = {};
    let condition = currentList.map(function(h) {
      return "id = " + h; //TODO unsafe
    }).join(" OR ");
    utils.spinQuery(Places.PlacesUtils.history.DBConnection, {
      "query"  : "SELECT place_id, from_visit FROM moz_historyvisits WHERE " +
                  condition + " LIMIT 5;",
      "names"  : ["from_visit", "place_id"],
      "params" : params,
    }).forEach(function({from_visit, place_id}) {
      console.log("FROM: " + from_visit);
      globalPlaces[place_id] = true;
      if (from_visit != 0)
        recurseList.push(from_visit);
    });
    getParentsHelper(recurseList);
  }
  getParentsHelper(hids);
  return globalPlaces;
}

TabFocus.prototype.getLastKVisits = function(pid, k) {
  let me = this;
  return utils.spinQuery(Places.PlacesUtils.history.DBConnection, {
    "query" : "SELECT id FROM moz_historyvisits WHERE place_id = :pid " + 
              "ORDER BY id DESC LIMIT :k",
    "params" : {"pid" : pid, "k":k},
    "names" : ["id"],
  }).map(function({id}) {
    return id;
  });
}

TabFocus.prototype.getPlaceIdFromURI = function(uri) {
  let me = this;
  let result = utils.spinQuery(Places.PlacesUtils.history.DBConnection, {
    "query" : "SELECT id FROM moz_places WHERE url = :uri",
    "params" : {"uri" : uri},
    "names" : ["id"],
  });
  if (result.length == 0)
    return 0;
  return result[0].id;
}

TabFocus.prototype.getParentSet = function(uri) {
  let me = this;
  let placeId = me.getPlaceIdFromURI(uri);
  let recentVisits = me.getLastKVisits(placeId, 5);
  return me.getParentsFromHIDs(recentVisits);
}

TabFocus.prototype.isRelated = function(uri1, uri2) {
  let me = this;
  let parents1 = me.getParentSet(uri1);
  let parents2 = me.getParentSet(uri2);
  for (let p1 in parents1) {
    if (p1 in parents2) {
      return true;
    }
  }
  return false;
}

TabFocus.prototype.moveTabs = function(clusters) {
  let me = this;
}

TabFocus.prototype.focus = function () {
  let me = this;

  let currentWindow = Svcs.Services.wm.getMostRecentWindow("navigator:browser");
  let gBrowser = currentWindow.gBrowser;
  let visibleTabs = gBrowser.visibleTabs;

  let clusters = {"in":{}, "out":{}};
  let activeTab = tabs.activeTab;
  let activeURI = activeTab.url;
  let activeRevHost = me.getRevHostFromURI(activeURI);
  if (!activeRevHost)
    return;
  
  /* prelim clustering by domain name */
  for (let i = 0; i < visibleTabs.length; i++) {
    let tab = visibleTabs[i];
    let uri = gBrowser.getBrowserForTab(tab).currentURI.spec;
    if (!uri)
      continue;
    let revHost = me.getRevHostFromURI(uri);
    if (revHost == activeRevHost)
      clusters.in[uri] = true;
    else
      clusters.out[uri] = true;
  }

  let unstable = true;
  while(unstable) {
    unstable = false;
    let movers = [];
    for (let inURI in clusters.in) {
      for (let outURI in clusters.out) {
        if (me.isRelated(inURI, outURI)) {
          movers.push(outURI)
          unstable = true;
        }
      }
    }
    for (let i = 0; i < movers.length; i++) {
      let uri = movers[i]
      clusters.in[uri] = true;
      delete clusters.out[uri];
    }
  }
  
  let moveTabs = [];
  for (let i = 0; i < visibleTabs.length; i++) {
    let tab = visibleTabs[i];
    let uri = gBrowser.getBrowserForTab(tab).currentURI.spec;
    if (uri in clusters.in)
      moveTabs.push(tab);
  }

  function initTabs() {
    let newGroup = currentWindow.TabView.getContentWindow().GroupItems.newGroup();
    let newGroupId = newGroup.id;
    moveTabs.forEach(function(moveTab) {
      currentWindow.TabView.moveTabTo(moveTab, newGroupId);
    });
    activeTab.activate()
  }

  if (currentWindow.TabView.getContentWindow() == null) {
    currentWindow.TabView._initFrame(initTabs);
  } else {
    initTabs();
  }

}

exports.TabFocus = TabFocus;
