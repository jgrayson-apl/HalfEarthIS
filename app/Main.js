/*
  Copyright 2017 Esri

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.​
*/

define([
  "calcite",
  "dojo/_base/declare",
  "ApplicationBase/ApplicationBase",
  "dojo/i18n!./nls/resources",
  "ApplicationBase/support/itemUtils",
  "ApplicationBase/support/domHelper",
  "dojo/_base/Color",
  "dojo/colors",
  "dojo/number",
  "dojo/date/locale",
  "dojo/on",
  "dojo/query",
  "dojo/dom",
  "dojo/dom-class",
  "dojo/dom-construct",
  "esri/request",
  "esri/identity/IdentityManager",
  "esri/core/Evented",
  "esri/core/watchUtils",
  "esri/core/promiseUtils",
  "esri/portal/Portal",
  "esri/layers/Layer",
  "esri/layers/GraphicsLayer",
  "esri/layers/support/RasterFunction",
  "esri/geometry/Extent",
  "esri/geometry/geometryEngine",
  "esri/geometry/SpatialReference",
  "esri/geometry/support/webMercatorUtils",
  "esri/Graphic",
  "esri/renderers/smartMapping/statistics/uniqueValues",
  "esri/widgets/Feature",
  "esri/widgets/FeatureForm",
  "esri/widgets/Home",
  "esri/widgets/Search",
  "esri/widgets/LayerList",
  "esri/widgets/Legend",
  "esri/widgets/ScaleBar",
  "esri/widgets/Compass",
  "esri/widgets/BasemapGallery",
  "esri/widgets/Expand",
  "esri/widgets/Sketch/SketchViewModel"
], function (calcite, declare, ApplicationBase, i18n, itemUtils, domHelper,
             Color, colors, number, locale, on, query, dom, domClass, domConstruct,
             esriRequest, IdentityManager, Evented, watchUtils, promiseUtils, Portal,
             Layer, GraphicsLayer, RasterFunction, Extent, geometryEngine, SpatialReference, webMercatorUtils,
             Graphic, uniqueValues, Feature, FeatureForm, Home, Search, LayerList,
             Legend, ScaleBar, Compass, BasemapGallery, Expand, SketchViewModel) {

  return declare([Evented], {

    /**
     *
     */
    constructor: function () {
      this.CSS = {
        loading: "configurable-application--loading"
      };
      this.base = null;

      // CALCITE WEB //
      calcite.init();
    },

    /**
     *
     * @param base
     */
    init: function (base) {
      if(!base) {
        console.error("ApplicationBase is not defined");
        return;
      }
      domHelper.setPageLocale(base.locale);
      domHelper.setPageDirection(base.direction);

      this.base = base;
      const config = base.config;
      const results = base.results;
      const find = config.find;
      const marker = config.marker;

      const allMapAndSceneItems = results.webMapItems.concat(results.webSceneItems);
      const validMapItems = allMapAndSceneItems.map(function (response) {
        return response.value;
      });

      const firstItem = validMapItems[0];
      if(!firstItem) {
        console.error("Could not load an item to display");
        return;
      }
      config.title = (config.title || itemUtils.getItemTitle(firstItem));
      domHelper.setPageTitle(config.title);

      const viewProperties = itemUtils.getConfigViewProperties(config);
      viewProperties.container = "view-container";
      viewProperties.constraints = { snapToZoom: false };

      const portalItem = this.base.results.applicationItem.value;
      const appProxies = (portalItem && portalItem.appProxies) ? portalItem.appProxies : null;

      itemUtils.createMapFromItem({ item: firstItem, appProxies: appProxies }).then((map) => {
        viewProperties.map = map;
        itemUtils.createView(viewProperties).then((view) => {
          itemUtils.findQuery(find, view).then(() => {
            itemUtils.goToMarker(marker, view).then(() => {
              this.viewReady(config, firstItem, view).then(() => {
                domClass.remove(document.body, this.CSS.loading);
              });
            });
          });
        });
      });
    },

    /**
     *
     * @param config
     * @param item
     * @param view
     */
    viewReady: function (config, item, view) {

      // TITLE //
      dom.byId("app-title-node").innerHTML = config.title;

      // LOADING //
      const updating_node = domConstruct.create("div", { className: "view-loading-node loader" });
      domConstruct.create("div", { className: "loader-bars" }, updating_node);
      domConstruct.create("div", { className: "loader-text font-size--3 text-white", innerHTML: "Updating..." }, updating_node);
      view.ui.add(updating_node, "bottom-right");
      watchUtils.init(view, "updating", (updating) => {
        domClass.toggle(updating_node, "is-active", updating);
      });


      // USER SIGN IN //
      return this.initializeUserSignIn(view).always(() => {

        // MAP DETAILS //
        this.displayMapDetails(item);

        // POPUP DOCKING OPTIONS //
        /*view.popup.dockEnabled = true;
        view.popup.dockOptions = {
          buttonEnabled: false,
          breakpoint: false,
          position: "top-center"
        };*/

        // SEARCH //
        const search = new Search({ view: view, searchTerm: this.base.config.search || "" });
        const searchExpand = new Expand({
          view: view,
          content: search,
          expandIconClass: "esri-icon-search",
          expandTooltip: "Search"
        });
        view.ui.add(searchExpand, { position: "top-left", index: 0 });

        // HOME //
        const home = new Home({ view: view });
        view.ui.add(home, { position: "top-left", index: 1 });

        // LAYER LIST //
        this.initializeLayerList(view);

        // APPLICATION READY //
        this.applicationReady(view);

      });

    },

    /**
     *
     * @param view
     */
    initializeLayerList: function (view) {

      // CREATE OPACITY NODE //
      const createOpacityNode = (item, parent_node) => {
        const opacity_node = domConstruct.create("div", { className: "opacity-node esri-widget", title: "Layer Opacity" }, parent_node);
        // domConstruct.create("span", { className: "font-size--3", innerHTML: "Opacity:" }, opacity_node);
        const opacity_input = domConstruct.create("input", { className: "opacity-input", type: "range", min: 0, max: 1.0, value: item.layer.opacity, step: 0.01 }, opacity_node);
        on(opacity_input, "input", () => {
          item.layer.opacity = opacity_input.valueAsNumber;
        });
        item.layer.watch("opacity", (opacity) => {
          opacity_input.valueAsNumber = opacity;
        });
        opacity_input.valueAsNumber = item.layer.opacity;
        return opacity_node;
      };
      // CREATE TOOLS NODE //
      const createToolsNode = (item, parent_node) => {
        // TOOLS NODE //
        const tools_node = domConstruct.create("div", { className: "opacity-node esri-widget" }, parent_node);

        // REORDER //
        const reorder_node = domConstruct.create("div", { className: "inline-block" }, tools_node);
        const reorder_up_node = domConstruct.create("button", { className: "btn-link icon-ui-up", title: "Move layer up..." }, reorder_node);
        const reorder_down_node = domConstruct.create("button", { className: "btn-link icon-ui-down", title: "Move layer down..." }, reorder_node);
        on(reorder_up_node, "click", () => {
          view.map.reorder(item.layer, view.map.layers.indexOf(item.layer) + 1);
        });
        on(reorder_down_node, "click", () => {
          view.map.reorder(item.layer, view.map.layers.indexOf(item.layer) - 1);
        });

        // REMOVE LAYER //
        const remove_layer_node = domConstruct.create("button", { className: "btn-link icon-ui-close right", title: "Remove layer from map..." }, tools_node);
        on.once(remove_layer_node, "click", () => {
          view.map.remove(item.layer);
          this.emit("layer-removed", item.layer);
        });

        // ZOOM TO //
        const zoom_to_node = domConstruct.create("button", { className: "btn-link icon-ui-zoom-in-magnifying-glass right", title: "Zoom to Layer" }, tools_node);
        on(zoom_to_node, "click", () => {
          view.goTo(item.layer.fullExtent);
        });

        // LAYER DETAILS //
        const itemDetailsPageUrl = `${this.base.portal.url}/home/item.html?id=${item.layer.portalItem.id}`;
        domConstruct.create("a", { className: "btn-link icon-ui-description icon-ui-blue right", title: "View details...", target: "_blank", href: itemDetailsPageUrl }, tools_node);

        return tools_node;
      };
      // LAYER LIST //
      const layerList = new LayerList({
        container: "layer-list-container",
        view: view,
        listItemCreatedFunction: (evt) => {
          const item = evt.item;
          if(item.layer && item.layer.portalItem) {

            // CREATE ITEM PANEL //
            const panel_node = domConstruct.create("div", { className: "esri-widget" });

            // LAYER TOOLS //
            createToolsNode(item, panel_node);

            // OPACITY //
            createOpacityNode(item, panel_node);

            // if(item.layer.type === "imagery") {
            //   this.configureImageryLayer(view, item.layer, panel_node);
            // }

            // LEGEND //
            if(item.layer.legendEnabled) {
              const legend = new Legend({ container: panel_node, view: view, layerInfos: [{ layer: item.layer }] })
            }

            // SET ITEM PANEL //
            item.panel = {
              title: "Settings",
              className: "esri-icon-settings",
              content: panel_node
            };
          }
        }
      });

    },

    /**
     * DISPLAY MAP DETAILS
     *
     * @param portalItem
     */
    displayMapDetails: function (portalItem) {

      const portal_url = this.base.portal ? (this.base.portal.urlKey ? `https://${this.base.portal.urlKey}.${this.base.portal.customBaseUrl}` : this.base.portal.url) : "https://www.arcgis.com";

      dom.byId("current-map-card-thumb").src = portalItem.thumbnailUrl;
      dom.byId("current-map-card-thumb").alt = portalItem.title;
      dom.byId("current-map-card-caption").innerHTML = `A map by ${portalItem.owner}`;
      dom.byId("current-map-card-caption").title = "Last modified on " + (new Date(portalItem.modified)).toLocaleString();
      dom.byId("current-map-card-title").innerHTML = portalItem.title;
      dom.byId("current-map-card-title").href = `${portal_url}/home/item.html?id=${portalItem.id}`;
      dom.byId("current-map-card-description").innerHTML = portalItem.description;

    },

    /**
     *
     * @returns {*}
     */
    initializeUserSignIn: function (view) {

      const checkSignInStatus = () => {
        return IdentityManager.checkSignInStatus(this.base.portal.url).then(userSignIn);
      };
      IdentityManager.on("credential-create", checkSignInStatus);
      IdentityManager.on("credential-destroy", checkSignInStatus);

      // SIGN IN NODE //
      const signInNode = dom.byId("sign-in-node");
      const userNode = dom.byId("user-node");

      // UPDATE UI //
      const updateSignInUI = () => {
        if(this.base.portal.user) {
          dom.byId("user-firstname-node").innerHTML = this.base.portal.user.fullName.split(" ")[0];
          dom.byId("user-fullname-node").innerHTML = this.base.portal.user.fullName;
          dom.byId("username-node").innerHTML = this.base.portal.user.username;
          dom.byId("user-thumb-node").src = this.base.portal.user.thumbnailUrl;
          domClass.add(signInNode, "hide");
          domClass.remove(userNode, "hide");
        } else {
          domClass.remove(signInNode, "hide");
          domClass.add(userNode, "hide");
        }
        return promiseUtils.resolve();
      };

      // SIGN IN //
      const userSignIn = () => {
        this.base.portal = new Portal({ url: this.base.config.portalUrl, authMode: "immediate" });
        return this.base.portal.load().then(() => {
          this.emit("portal-user-change", {});
          return updateSignInUI();
        }).otherwise(console.warn);
      };

      // SIGN OUT //
      const userSignOut = () => {
        IdentityManager.destroyCredentials();
        this.base.portal = new Portal({});
        this.base.portal.load().then(() => {
          this.base.portal.user = null;
          this.emit("portal-user-change", {});
          return updateSignInUI();
        }).otherwise(console.warn);

      };

      // USER SIGN IN //
      on(signInNode, "click", userSignIn);

      // SIGN OUT NODE //
      const signOutNode = dom.byId("sign-out-node");
      if(signOutNode) {
        on(signOutNode, "click", userSignOut);
      }

      return checkSignInStatus();
    },

    /**
     *
     * @param view
     * @param layer_title
     * @param ready_callback
     * @returns {*}
     */
    whenLayerReady: function (view, layer_title, ready_callback) {

      const layer = view.map.layers.find(layer => {
        return (layer.title === layer_title);
      });
      if(layer) {
        return layer.load().then(() => {
          if(layer.visible) {
            return view.whenLayerView(layer).then((layerView) => {

              if(ready_callback) {
                ready_callback({ layer: layer, layerView: layerView });
              }

              // layerView.watch("updating", updating => {
              //   console.info(layer.title, " -updating- ", updating);
              // });

              if(layerView.updating) {
                return watchUtils.whenNotOnce(layerView, "updating").then(() => {
                  return { layer: layer, layerView: layerView };
                });
              } else {
                return watchUtils.whenOnce(layerView, "updating").then(() => {
                  return watchUtils.whenNotOnce(layerView, "updating").then(() => {
                    return { layer: layer, layerView: layerView };
                  });
                });
              }
            });
          } else {
            return promiseUtils.resolve({ layer: layer, layerView: null });
          }
        });
      } else {
        return promiseUtils.reject(new Error(`Can't find layer '${layer_title}'`));
      }

    },


    /**
     * APPLICATION READY
     *
     * @param view
     */
    applicationReady: function (view) {

      const world_extent_wgs84 = new Extent({ xmin: -180.0, xmax: 180.0, ymin: -90.0, ymax: 90.0, spatialReference: { wkid: 4326 } });

      this.whenLayerReady(view, "Birds Image").then(birds_layer_info => {
        const birds_layer = birds_layer_info.layer;

        this.whenLayerReady(view, "Fishes Image").then(fishes_layer_info => {
          const fishes_layer = fishes_layer_info.layer;

          // if(fishes_layer_info.layerView.updating){
          //   console.warn("Fishes layer is still updating...");
          // }

          //  CURRENT LAYER //
          let current_layer = fishes_layer;

          //  TOGGLE CURRENT LAYER //
          const layer_switch = dom.byId("layer-switch");
          on(layer_switch, "change", () => {
            fishes_layer.visible = !layer_switch.checked;
            birds_layer.visible = layer_switch.checked;
            current_layer = layer_switch.checked ? birds_layer : fishes_layer;
            updateLayerDetails();
            this.emit("clear-statistics", {});
          });

          //
          // INTERPOLATION - RSP_BilinearInterpolation | RSP_CubicConvolution | RSP_Majority | RSP_NearestNeighbor //
          //   - 4.11 workaround - set initial values //
          //
          birds_layer.interpolation = "RSP_BilinearInterpolation";
          fishes_layer.interpolation = "RSP_NearestNeighbor";
          const interpolation_select = dom.byId("interpolation-select");
          on(interpolation_select, "change", () => {
            current_layer.interpolation = interpolation_select.value;
            // CHANGING INTERPOLATION DOESN'T AUTOMATICALLY REFRESH THE LAYER //
            current_layer.refresh();
          });

          // CURRENT LAYER DETAILS //
          const mosaic_rule_node = dom.byId("mosaic-rule-node");
          const rendering_rule_node = dom.byId("rendering-rule-node");
          const updateLayerDetails = () => {
            mosaic_rule_node.innerHTML = JSON.stringify(current_layer.mosaicRule.toJSON(), null, "  ");
            rendering_rule_node.innerHTML = JSON.stringify(current_layer.renderingRule.toJSON(), null, "  ");
            interpolation_select.value = current_layer.interpolation;
          };
          updateLayerDetails();


          // CUSTOM RENDERING RULE //
          const DRA_switch = dom.byId("dra-switch");
          const ramp_algorithm_select = dom.byId("ramp-algorithm-select");
          const from_color_node = dom.byId("from-color-node");
          const to_color_node = dom.byId("to-color-node");

          // LAYER STATISTICS //
          const layer_statistics = new Map();
          const getLayerStatistics = () => {
            const layer_stats = layer_statistics.get(current_layer.title);
            if(layer_stats) {
              return promiseUtils.resolve(layer_stats);
            } else {
              return getStatistics(world_extent_wgs84).then(stats_response => {
                const stats = [[stats_response.min, stats_response.max, stats_response.mean, stats_response.standardDeviation]];
                layer_statistics.set(current_layer.title, stats);
                return stats;
              });
            }
          };

          /**
           * OVERRIDE RENDERING RULE
           */
          const updateCustomRenderingRule = () => {

            // esriHSVAlgorithm | esriCIELabAlgorithm | esriLabLChAlgorithm  //
            const algorithm = ramp_algorithm_select.value;

            // COLORS //
            const from_color = new Color(from_color_node.dataset.clr);
            const to_color = new Color(to_color_node.dataset.clr);

            // USE DRA - DYNAMIC RANGE ADJUSTMENT //
            const use_DRA = DRA_switch.checked;

            // GET LAYER STATS //
            getLayerStatistics().then(layer_stats => {

              //
              // https://developers.arcgis.com/documentation/common-data-types/raster-function-objects.htm#ESRI_SECTION1_7545363F0B8A4B7B931A54B3C4189D9D
              //
              const stretch_function = new RasterFunction({
                functionName: "Stretch",
                functionArguments: {
                  StretchType: 3,
                  Min: 0,
                  Max: 255,
                  NumberOfStandardDeviations: 2.5,
                  DRA: use_DRA,
                  Statistics: use_DRA ? undefined : layer_stats,
                  UseGamma: true,
                  Gamma: [1.0]
                }
              });
              const colorramp_stretch_funciton = new RasterFunction({
                functionName: "Colormap",
                functionArguments: {
                  colorramp: {
                    type: "algorithmic",
                    fromColor: from_color.toRgba(),
                    toColor: to_color.toRgba(),
                    algorithm: algorithm
                  },
                  Raster: stretch_function
                }
              });
              // CHANGING RENDERING RULE AUTOMATICALLY REFRESH THE LAYER //
              current_layer.renderingRule = colorramp_stretch_funciton;
              updateLayerDetails();
            });
          };
          // ALGORITHM CHANGED - CURRENTLY HIDDEN //
          on(ramp_algorithm_select, "change", () => {
            updateCustomRenderingRule();
          });
          // DRA CHANGED //
          on(DRA_switch, "change", () => {
            updateCustomRenderingRule();
          });

          // COLOR NODE CLICKED //
          query(".color-node").forEach(node => {
            on(node, "click", () => {
              const new_color = new Color([Math.random() * 255, Math.random() * 255, Math.random() * 255, 1]);
              node.style.backgroundColor = node.dataset.clr = new_color.toHex();
              updateCustomRenderingRule();
            });
          });

          // NONE RASTER FUNCTION //
          const none_raster_function = new RasterFunction({ functionName: "None" });

          //
          // STATISTICS //
          //
          // https://developers.arcgis.com/rest/services-reference/compute-statistics-and-histograms.htm
          //
          const getStatistics = (area_of_interest) => {
            // GIVEN AN AREA OF INTEREST, CALCULATE STATISTICS AT FULL DATASET RESOLUTION //
            return esriRequest(`${current_layer.url}/computeStatisticsHistograms`, {
              query: {
                f: "json",
                geometryType: (area_of_interest.type === "polygon") ? "esriGeometryPolygon" : "esriGeometryEnvelope",
                geometry: JSON.stringify(area_of_interest.toJSON()),
                renderingRule: JSON.stringify(none_raster_function.toJSON()),
                mosaicRule: JSON.stringify(current_layer.mosaicRule.toJSON()),
                pixelSize: `${current_layer.pixelSizeX},${current_layer.pixelSizeY}`
              }
            }).then(statsResponse => {
              if(statsResponse.data.statistics.length) {
                const stats = statsResponse.data.statistics[0];
                stats.sum = Math.round(stats.count * stats.mean);
                return stats;
              } else {
                return null;
              }
            });
          };

          // STATISTICS RESULTS UI //
          const statistics_node = dom.byId("statistics-node");
          this.on("clear-statistics", () => {
            statistics_node.innerHTML = "";
          });
          this.on("get-statistics", evt => {
            let aoi = evt.aoi;

            // MAKE SURE GEOMETRY IS IN WGS84 WHEN ASKING FOR STATISTICS //
            if(!aoi.spatialReference.isWGS84) {
              aoi = webMercatorUtils.webMercatorToGeographic(aoi);
            }

            this.setMask(aoi);
            getStatistics(aoi).then(statistics => {
              if(statistics) {
                statistics_node.innerHTML = JSON.stringify(statistics, null, "  ");
              } else {
                statistics_node.innerHTML = "No statistics available for this area of interest..."
              }
            }, error => {
              statistics_node.innerHTML = `${error.message} - ${error.details.messages[0]}`;
            });
          });

          // CLEAR STATISTICS //
          const clearStatsBtn = dom.byId("clear-statistics-node");
          on(clearStatsBtn, "click", () => {
            this.emit("clear-statistics", {});
          });

          // AREA OF INTEREST SYMBOL AND LAYER //
          const aoi_symbol = {
            type: "simple-fill",
            color: Color.named.transparent,
            outline: {
              style: "dash",
              color: Color.named.white,
              width: 1.5
            }
          };
          const aoi_layer = new GraphicsLayer({ title: "Area of Interest" });
          view.map.add(aoi_layer);

          // MASK //
          const mask_symbol = {
            type: "simple-fill",
            color: Color.named.white.concat(0.8),
            outline: {
              color: Color.named.transparent,
              width: 0.0
            }
          };
          const mask_graphic = new Graphic({ symbol: mask_symbol });
          const mask_layer = new GraphicsLayer({ title: "Area of Interest Mask", graphics: [mask_graphic] });
          view.map.add(mask_layer);

          const mask_switch = dom.byId("mask-switch");
          this.setMask = (aoi) => {
            mask_graphic.geometry = (mask_switch.checked && (aoi != null)) ? geometryEngine.difference(world_extent_wgs84, aoi) : null;
          };
          this.on("clear-statistics", () => {
            mask_graphic.geometry = null;
          });

          // INITIALIZE AOI SKETCH //
          this.initializeAOISketch(view, aoi_layer, aoi_symbol);

          // COUNTRY //
          this.initializeCountryList(view, aoi_layer, aoi_symbol);

          // PROTECTED AREAS //
          this.initializeProtectedAreasList(view, aoi_layer, aoi_symbol);

        });
      });

    },

    /**
     *
     * @param view
     * @param aoi_layer
     * @param aoi_symbol
     */
    initializeCountryList: function (view, aoi_layer, aoi_symbol) {

      // FIND COUNTRY LAYER //
      this.whenLayerReady(view, "World Countries").then(layer_info => {
        // COUNTRY LAYER //
        const country_layer = layer_info.layer;
        // COUNTRY SELECT //
        const country_select = dom.byId("country-select");
        // GET LIST OF COUNTRY NAMES //
        uniqueValues({ layer: country_layer, field: "Country" }).then(uvResult => {
          // ADD COUNTRY OPTIONS TO SELECT //
          uvResult.uniqueValueInfos.forEach(uvInfo => {
            domConstruct.create("option", { innerHTML: uvInfo.value, value: uvInfo.value }, country_select);
          });
          // WHEN COUNTRY IS SELECTED //
          on(country_select, "change", () => {
            aoi_layer.removeAll();
            this.setMask();
            // GET COUNTRY FEATURE //
            country_layer.queryFeatures({
              where: `Country = '${country_select.value}'`,
              returnGeometry: true,
              geometryPrecision: 3
            }).then(selectedCountryFeatureSet => {
              const selected_country = selectedCountryFeatureSet.features[0];
              const selected_aoi = selected_country.geometry.clone();
              aoi_layer.add({ geometry: selected_aoi, symbol: aoi_symbol });
              this.emit("get-statistics", { aoi: selected_aoi });
            });
          });
          domClass.remove(country_select, "btn-disabled");
        });
      });
    },

    /**
     *
     * @param view
     * @param aoi_layer
     * @param aoi_symbol
     */
    initializeProtectedAreasList: function (view, aoi_layer, aoi_symbol) {

      // FIND PROTECTED AREAS LAYER //
      const protected_areas_layer = view.map.layers.find(layer => {
        return (layer.title === "Protected Areas");
      });
      protected_areas_layer.load().then(() => {
        view.whenLayerView(protected_areas_layer).then(protected_areas_layerView => {

          // VIEW CLICK HANDLE //
          const click_handle = on.pausable(view, "click", click_evt => {
            aoi_layer.removeAll();
            this.setMask();
            protected_areas_layer.queryFeatures({
              geometry: click_evt.mapPoint,
              returnGeometry: true,
              geometryPrecision: 3
            }).then(protectedAreasFeatureSet => {
              const selected_protected_area = protectedAreasFeatureSet.features[0];
              const selected_aoi = selected_protected_area.geometry.clone();
              aoi_layer.add({ geometry: selected_aoi, symbol: aoi_symbol });
              this.emit("get-statistics", { aoi: selected_aoi });
              domClass.remove(select_protected_area_btn, "icon-ui-map-pin btn-disabled");
              click_handle.pause();
            }, console.error);
          });
          click_handle.pause();

          // SELECT PROTECTED AREA BUTTON //
          const select_protected_area_btn = dom.byId("select-protected-area-btn");
          on(select_protected_area_btn, "click", () => {
            domClass.toggle(select_protected_area_btn, "icon-ui-map-pin btn-disabled");
            if(domClass.contains(select_protected_area_btn, "icon-ui-map-pin")) {
              click_handle.resume();
            } else {
              domClass.remove(select_protected_area_btn, "icon-ui-map-pin btn-disabled");
              click_handle.pause();
            }
          });

          // ONLY ENABLE THE SELECT BUTTON WHEN THE LAYER IS WITHIN SCALE //
          watchUtils.init(protected_areas_layerView, "suspended", suspended => {
            domClass.toggle(select_protected_area_btn, "btn-disabled", suspended);
          });

        });
      });

    },

    /**
     *
     * @param view
     * @param aoi_layer
     * @param aoi_symbol
     */
    initializeAOISketch: function (view, aoi_layer, aoi_symbol) {

      // SKETCH VIEW MODEL //
      const sketchVM = new SketchViewModel({
        view: view,
        layer: aoi_layer,
        polygonSymbol: aoi_symbol,
        activeFillSymbol: aoi_symbol,
        updatePolygonSymbol: aoi_symbol
      });
      //console.info(sketchVM);

      // SKETCH AOI ON SCREEN //
      sketchVM.on("create", (create_evt) => {
        switch (create_evt.state) {
          case "complete":
            this.emit("get-statistics", { aoi: create_evt.graphic.geometry.clone() });
          case "cancel":
            sketchVM.reset();
            view.container.style.cursor = "default";
            domClass.remove(createAOIBtn, "icon-ui-edit btn-disabled");
        }
      });
      sketchVM.on("update", (update_evt) => {
        if(update_evt.state === "active" && update_evt.toolEventInfo.type.endsWith("-stop")) {
          this.emit("get-statistics", { aoi: update_evt.graphics[0].geometry.clone() });
        }
        if(update_evt.state === "complete") {
          this.emit("get-statistics", { aoi: update_evt.graphics[0].geometry.clone() });
        }
      });

      this.on("clear-statistics", () => {
        sketchVM.reset();
        aoi_layer.removeAll();
        this.setMask();
      });

      const createAOIBtn = dom.byId("create-aoi-btn");
      on(createAOIBtn, "click", () => {
        domClass.toggle(createAOIBtn, "icon-ui-edit btn-disabled");
        if(domClass.contains(createAOIBtn, "icon-ui-edit")) {
          aoi_layer.removeAll();
          this.setMask();
          sketchVM.create("circle");
          view.focus();
          view.container.style.cursor = "crosshair";
        } else {
          sketchVM.cancel();
        }
      });
      domClass.remove(createAOIBtn, "btn-disabled");

    }

  });
});