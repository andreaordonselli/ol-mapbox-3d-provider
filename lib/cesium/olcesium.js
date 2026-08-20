var olcs_unused_var;
/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/olcs/AbstractSynchronizer.ts":
/*!******************************************!*\
  !*** ./src/olcs/AbstractSynchronizer.ts ***!
  \******************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ AbstractSynchronizer)
/* harmony export */ });
/* harmony import */ var ol_Observable_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ol/Observable.js */ "ol/Observable.js");
/* harmony import */ var ol_Observable_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(ol_Observable_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var ol_layer_Group_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ol/layer/Group.js */ "ol/layer/Group.js");
/* harmony import */ var ol_layer_Group_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(ol_layer_Group_js__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _util__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./util */ "./src/olcs/util.ts");



class AbstractSynchronizer {
  constructor(map, scene) {
    /**
     * Map of OpenLayers layer ids (from getUid) to the Cesium ImageryLayers.
     * Null value means, that we are unable to create equivalent layers.
     */
    this.layerMap = {};
    /**
     * Map of listen keys for OpenLayers layer layers ids (from getUid).
     */
    this.olLayerListenKeys = {};
    /**
     * Map of listen keys for OpenLayers layer groups ids (from getUid).
     */
    this.olGroupListenKeys_ = {};
    this.map = map;
    this.view = map.getView();
    this.scene = scene;
    this.olLayers = map.getLayerGroup().getLayers();
    this.mapLayerGroup = map.getLayerGroup();
  }

  /**
   * Destroy all and perform complete synchronization of the layers.
   */
  synchronize() {
    this.destroyAll();
    this.addLayers_(this.mapLayerGroup);
  }

  /**
   * Order counterparts using the same algorithm as the Openlayers renderer:
   * z-index then original sequence order.
   */
  orderLayers() {
    // Ordering logics is handled in subclasses.
  }

  /**
   * Add a layer hierarchy.
   */
  addLayers_(root) {
    const fifo = [{
      layer: root,
      parents: []
    }];
    while (fifo.length > 0) {
      const olLayerWithParents = fifo.splice(0, 1)[0];
      const olLayer = olLayerWithParents.layer;
      const olLayerId = (0,_util__WEBPACK_IMPORTED_MODULE_2__.getUid)(olLayer).toString();
      this.olLayerListenKeys[olLayerId] = [];
      console.assert(!this.layerMap[olLayerId]);
      let cesiumObjects = null;
      if (olLayer instanceof (ol_layer_Group_js__WEBPACK_IMPORTED_MODULE_1___default())) {
        this.listenForGroupChanges_(olLayer);
        if (olLayer !== this.mapLayerGroup) {
          cesiumObjects = this.createSingleLayerCounterparts(olLayerWithParents);
        }
        if (!cesiumObjects) {
          olLayer.getLayers().forEach(l => {
            if (l) {
              const newOlLayerWithParents = {
                layer: l,
                parents: olLayer === this.mapLayerGroup ? [] : [olLayerWithParents.layer].concat(olLayerWithParents.parents)
              };
              fifo.push(newOlLayerWithParents);
            }
          });
        }
      } else {
        cesiumObjects = this.createSingleLayerCounterparts(olLayerWithParents);
        if (!cesiumObjects) {
          // keep an eye on the layers that once failed to be added (might work when the layer is updated)
          // for example when a source is set after the layer is added to the map
          const layerId = olLayerId;
          const layerWithParents = olLayerWithParents;
          const onLayerChange = () => {
            const cesiumObjs = this.createSingleLayerCounterparts(layerWithParents);
            if (cesiumObjs) {
              // unsubscribe event listener
              layerWithParents.layer.un('change', onLayerChange);
              this.addCesiumObjects_(cesiumObjs, layerId, layerWithParents.layer);
              this.orderLayers();
            }
          };
          this.olLayerListenKeys[olLayerId].push(layerWithParents.layer.on('change', onLayerChange));
        }
      }
      // add Cesium layers
      if (cesiumObjects) {
        this.addCesiumObjects_(cesiumObjects, olLayerId, olLayer);
      }
    }
    this.orderLayers();
  }

  /**
   * Add Cesium objects.
   */
  addCesiumObjects_(cesiumObjects, layerId, layer) {
    this.layerMap[layerId] = cesiumObjects;
    this.olLayerListenKeys[layerId].push(layer.on('change:zIndex', () => this.orderLayers()));
    cesiumObjects.forEach(cesiumObject => {
      this.addCesiumObject(cesiumObject);
    });
  }

  /**
   * Remove and destroy a single layer.
   * @param {ol.layer.Layer} layer
   * @return {boolean} counterpart destroyed
   */
  removeAndDestroySingleLayer_(layer) {
    const uid = (0,_util__WEBPACK_IMPORTED_MODULE_2__.getUid)(layer).toString();
    const counterparts = this.layerMap[uid];
    if (!!counterparts) {
      counterparts.forEach(counterpart => {
        this.removeSingleCesiumObject(counterpart, false);
        this.destroyCesiumObject(counterpart);
      });
      this.olLayerListenKeys[uid].forEach(ol_Observable_js__WEBPACK_IMPORTED_MODULE_0__.unByKey);
      delete this.olLayerListenKeys[uid];
    }
    delete this.layerMap[uid];
    return !!counterparts;
  }

  /**
   * Unlisten a single layer group.
   */
  unlistenSingleGroup_(group) {
    if (group === this.mapLayerGroup) {
      return;
    }
    const uid = (0,_util__WEBPACK_IMPORTED_MODULE_2__.getUid)(group).toString();
    const keys = this.olGroupListenKeys_[uid];
    keys.forEach(key => {
      (0,ol_Observable_js__WEBPACK_IMPORTED_MODULE_0__.unByKey)(key);
    });
    delete this.olGroupListenKeys_[uid];
    delete this.layerMap[uid];
  }

  /**
   * Remove layer hierarchy.
   */
  removeLayer_(root) {
    if (!!root) {
      const fifo = [root];
      while (fifo.length > 0) {
        const olLayer = fifo.splice(0, 1)[0];
        const done = this.removeAndDestroySingleLayer_(olLayer);
        if (olLayer instanceof (ol_layer_Group_js__WEBPACK_IMPORTED_MODULE_1___default())) {
          this.unlistenSingleGroup_(olLayer);
          if (!done) {
            // No counterpart for the group itself so removing
            // each of the child layers.
            olLayer.getLayers().forEach(l => {
              fifo.push(l);
            });
          }
        }
      }
    }
  }

  /**
   * Register listeners for single layer group change.
   */
  listenForGroupChanges_(group) {
    const uuid = (0,_util__WEBPACK_IMPORTED_MODULE_2__.getUid)(group).toString();
    console.assert(this.olGroupListenKeys_[uuid] === undefined);
    const listenKeyArray = [];
    this.olGroupListenKeys_[uuid] = listenKeyArray;

    // only the keys that need to be relistened when collection changes
    let contentKeys = [];
    const listenAddRemove = function () {
      const collection = group.getLayers();
      if (collection) {
        contentKeys = [collection.on('add', event => {
          this.addLayers_(event.element);
        }), collection.on('remove', event => {
          this.removeLayer_(event.element);
        })];
        listenKeyArray.push(...contentKeys);
      }
    }.bind(this);
    listenAddRemove();
    listenKeyArray.push(group.on('change:layers', e => {
      contentKeys.forEach(el => {
        const i = listenKeyArray.indexOf(el);
        if (i >= 0) {
          listenKeyArray.splice(i, 1);
        }
        (0,ol_Observable_js__WEBPACK_IMPORTED_MODULE_0__.unByKey)(el);
      });
      listenAddRemove();
    }));
  }

  /**
   * Destroys all the created Cesium objects.
   */
  destroyAll() {
    this.removeAllCesiumObjects(true); // destroy
    let objKey;
    for (objKey in this.olGroupListenKeys_) {
      const keys = this.olGroupListenKeys_[objKey];
      keys.forEach(ol_Observable_js__WEBPACK_IMPORTED_MODULE_0__.unByKey);
    }
    for (objKey in this.olLayerListenKeys) {
      this.olLayerListenKeys[objKey].forEach(ol_Observable_js__WEBPACK_IMPORTED_MODULE_0__.unByKey);
    }
    this.olGroupListenKeys_ = {};
    this.olLayerListenKeys = {};
    this.layerMap = {};
  }

  /**
   * Adds a single Cesium object to the collection.
   */

  /**
   * Remove single Cesium object from the collection.
   */
}

/***/ }),

/***/ "./src/olcs/AutoRenderLoop.ts":
/*!************************************!*\
  !*** ./src/olcs/AutoRenderLoop.ts ***!
  \************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ AutoRenderLoop)
/* harmony export */ });
/**
 * By default Cesium (used to?) renders as often as possible.
 * This is a waste of resources (CPU/GPU/battery).
 * An alternative mechanism in Cesium is on-demand rendering.
 * This class makes use of this alternative method and add some additionnal render points.
 */
class AutoRenderLoop {
  /**
   * @param ol3d
   */
  constructor(ol3d) {
    this.repaintEventNames_ = ['mousemove', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'touchmove', 'pointerdown', 'pointerup', 'pointermove', 'wheel'];
    this.ol3d = ol3d;
    this.scene_ = ol3d.getCesiumScene();
    this.canvas_ = this.scene_.canvas;
    this._boundNotifyRepaintRequired = this.notifyRepaintRequired.bind(this);
    this.enable();
  }

  /**
   * Enable.
   */
  enable() {
    this.scene_.requestRenderMode = true;
    this.scene_.maximumRenderTimeChange = 1000;
    for (const repaintKey of this.repaintEventNames_) {
      this.canvas_.addEventListener(repaintKey, this._boundNotifyRepaintRequired, false);
    }
    window.addEventListener('resize', this._boundNotifyRepaintRequired, false);

    // Listen for changes on the layer group
    this.ol3d.getOlMap().getLayerGroup().on('change', this._boundNotifyRepaintRequired);
  }

  /**
   * Disable.
   */
  disable() {
    for (const repaintKey of this.repaintEventNames_) {
      this.canvas_.removeEventListener(repaintKey, this._boundNotifyRepaintRequired, false);
    }
    window.removeEventListener('resize', this._boundNotifyRepaintRequired, false);
    this.ol3d.getOlMap().getLayerGroup().un('change', this._boundNotifyRepaintRequired);
    this.scene_.requestRenderMode = false;
  }

  /**
   * Restart render loop.
   * Force a restart of the render loop.
   */
  restartRenderLoop() {
    this.notifyRepaintRequired();
  }
  notifyRepaintRequired() {
    this.scene_.requestRender();
  }
}

/***/ }),

/***/ "./src/olcs/Camera.ts":
/*!****************************!*\
  !*** ./src/olcs/Camera.ts ***!
  \****************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ Camera),
/* harmony export */   identityProjection: () => (/* binding */ identityProjection)
/* harmony export */ });
/* harmony import */ var ol_Observable_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ol/Observable.js */ "ol/Observable.js");
/* harmony import */ var ol_Observable_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(ol_Observable_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _math__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./math */ "./src/olcs/math.ts");
/* harmony import */ var ol_proj_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ol/proj.js */ "ol/proj.js");
/* harmony import */ var ol_proj_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(ol_proj_js__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _core__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./core */ "./src/olcs/core.ts");




/**
 * @param input Input coordinate array.
 * @param opt_output Output array of coordinate values.
 * @param opt_dimension Dimension.
 * @return Input coordinate array (same array as input).
 */
function identityProjection(input, opt_output, opt_dimension) {
  const dim = opt_dimension || input.length;
  if (opt_output) {
    for (let i = 0; i < dim; ++i) {
      opt_output[i] = input[i];
    }
  }
  return input;
}
class Camera {
  /**
   * This object takes care of additional 3d-specific properties of the view and
   * ensures proper synchronization with the underlying raw Cesium.Camera object.
   */
  constructor(scene, map) {
    this.viewListenKey_ = null;
    this.toLonLat_ = identityProjection;
    this.fromLonLat_ = identityProjection;
    /**
     * 0 -- topdown, PI/2 -- the horizon
     */
    this.tilt_ = 0;
    this.distance_ = 0;
    this.lastCameraViewMatrix_ = null;
    /**
     * This is used to discard change events on view caused by updateView method.
     */
    this.viewUpdateInProgress_ = false;
    this.scene_ = scene;
    this.cam_ = scene.camera;
    this.map_ = map;
    this.map_.on('change:view', e => {
      this.setView_(this.map_.getView());
    });
    this.setView_(this.map_.getView());
  }
  destroy() {
    (0,ol_Observable_js__WEBPACK_IMPORTED_MODULE_0__.unByKey)(this.viewListenKey_);
    this.viewListenKey_ = null;
  }

  /**
   * @param {?ol.View} view New view to use.
   * @private
   */
  setView_(view) {
    if (this.view_) {
      (0,ol_Observable_js__WEBPACK_IMPORTED_MODULE_0__.unByKey)(this.viewListenKey_);
      this.viewListenKey_ = null;
    }
    this.view_ = view;
    if (view) {
      const toLonLat = (0,ol_proj_js__WEBPACK_IMPORTED_MODULE_2__.getTransform)(view.getProjection(), 'EPSG:4326');
      const fromLonLat = (0,ol_proj_js__WEBPACK_IMPORTED_MODULE_2__.getTransform)('EPSG:4326', view.getProjection());
      console.assert(toLonLat && fromLonLat);
      this.toLonLat_ = toLonLat;
      this.fromLonLat_ = fromLonLat;
      this.viewListenKey_ = view.on('propertychange', e => this.handleViewChangedEvent_());
      this.readFromView();
    } else {
      this.toLonLat_ = identityProjection;
      this.fromLonLat_ = identityProjection;
    }
  }
  handleViewChangedEvent_() {
    if (!this.viewUpdateInProgress_) {
      this.readFromView();
    }
  }

  /**
   * @deprecated
   * @param heading In radians.
   */
  setHeading(heading) {
    if (!this.view_) {
      return;
    }
    this.view_.setRotation(heading);
  }

  /**
   * @deprecated
   * @return Heading in radians.
   */
  getHeading() {
    if (!this.view_) {
      return undefined;
    }
    const rotation = this.view_.getRotation();
    return rotation || 0;
  }

  /**
   * @param tilt In radians.
   */
  setTilt(tilt) {
    this.tilt_ = tilt;
    this.updateCamera_();
  }

  /**
   * @return Tilt in radians.
   */
  getTilt() {
    return this.tilt_;
  }

  /**
   * @param distance In meters.
   */
  setDistance(distance) {
    this.distance_ = distance;
    this.updateCamera_();
    this.updateView();
  }

  /**
   * @return Distance in meters.
   */
  getDistance() {
    return this.distance_;
  }

  /**
   * @deprecated
   * Shortcut for ol.View.setCenter().
   * @param center Same projection as the ol.View.
   */
  setCenter(center) {
    if (!this.view_) {
      return;
    }
    this.view_.setCenter(center);
  }

  /**
   * @deprecated
   * Shortcut for ol.View.getCenter().
   * @return {ol.Coordinate|undefined} Same projection as the ol.View.
   * @api
   */
  getCenter() {
    if (!this.view_) {
      return undefined;
    }
    return this.view_.getCenter();
  }

  /**
   * Sets the position of the camera.
   * @param position Same projection as the ol.View.
   */
  setPosition(position) {
    if (!this.toLonLat_) {
      return;
    }
    const ll = this.toLonLat_(position);
    console.assert(ll);
    const carto = new Cesium.Cartographic((0,_math__WEBPACK_IMPORTED_MODULE_1__.toRadians)(ll[0]), (0,_math__WEBPACK_IMPORTED_MODULE_1__.toRadians)(ll[1]), this.getAltitude());
    this.cam_.setView({
      destination: Cesium.Ellipsoid.WGS84.cartographicToCartesian(carto)
    });
    this.updateView();
  }

  /**
   * Calculates position under the camera.
   * @return Coordinates in same projection as the ol.View.
   * @api
   */
  getPosition() {
    if (!this.fromLonLat_) {
      return undefined;
    }
    const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(this.cam_.position);
    const pos = this.fromLonLat_([(0,_math__WEBPACK_IMPORTED_MODULE_1__.toDegrees)(carto.longitude), (0,_math__WEBPACK_IMPORTED_MODULE_1__.toDegrees)(carto.latitude)]);
    console.assert(pos);
    return pos;
  }

  /**
   * @param altitude In meters.
   */
  setAltitude(altitude) {
    const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(this.cam_.position);
    carto.height = altitude;
    this.cam_.position = Cesium.Ellipsoid.WGS84.cartographicToCartesian(carto);
    this.updateView();
  }

  /**
   * @return Altitude in meters.
   */
  getAltitude() {
    const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(this.cam_.position);
    return carto.height;
  }

  /**
   * Updates the state of the underlying Cesium.Camera
   * according to the current values of the properties.
   */
  updateCamera_() {
    if (!this.view_ || !this.toLonLat_) {
      return;
    }
    const center = this.view_.getCenter();
    if (!center) {
      return;
    }
    const ll = this.toLonLat_(center);
    console.assert(ll);
    const carto = new Cesium.Cartographic((0,_math__WEBPACK_IMPORTED_MODULE_1__.toRadians)(ll[0]), (0,_math__WEBPACK_IMPORTED_MODULE_1__.toRadians)(ll[1]));
    if (this.scene_.globe) {
      const height = this.scene_.globe.getHeight(carto);
      carto.height = height || 0;
    }
    const destination = Cesium.Ellipsoid.WGS84.cartographicToCartesian(carto);
    const orientation = {
      pitch: this.tilt_ - Cesium.Math.PI_OVER_TWO,
      heading: -this.view_.getRotation(),
      roll: undefined
    };
    this.cam_.setView({
      destination,
      orientation
    });
    this.cam_.moveBackward(this.distance_);
    this.checkCameraChange(true);
  }

  /**
   * Calculates the values of the properties from the current ol.View state.
   */
  readFromView() {
    if (!this.view_ || !this.toLonLat_) {
      return;
    }
    const center = this.view_.getCenter();
    if (center === undefined || center === null) {
      return;
    }
    const ll = this.toLonLat_(center);
    console.assert(ll);
    const resolution = this.view_.getResolution();
    this.distance_ = this.calcDistanceForResolution(resolution || 0, (0,_math__WEBPACK_IMPORTED_MODULE_1__.toRadians)(ll[1]));
    this.updateCamera_();
  }

  /**
   * Calculates the values of the properties from the current Cesium.Camera state.
   * Modifies the center, resolution and rotation properties of the view.
   */
  updateView() {
    if (!this.view_ || !this.fromLonLat_) {
      return;
    }
    this.viewUpdateInProgress_ = true;

    // target & distance
    const ellipsoid = Cesium.Ellipsoid.WGS84;
    const scene = this.scene_;
    const target = (0,_core__WEBPACK_IMPORTED_MODULE_3__.pickCenterPoint)(scene);
    let bestTarget = target;
    if (!bestTarget) {
      //TODO: how to handle this properly ?
      const globe = scene.globe;
      const carto = this.cam_.positionCartographic.clone();
      const height = globe.getHeight(carto);
      carto.height = height || 0;
      bestTarget = Cesium.Ellipsoid.WGS84.cartographicToCartesian(carto);
    }
    this.distance_ = Cesium.Cartesian3.distance(bestTarget, this.cam_.position);
    const bestTargetCartographic = ellipsoid.cartesianToCartographic(bestTarget);
    this.view_.setCenter(this.fromLonLat_([(0,_math__WEBPACK_IMPORTED_MODULE_1__.toDegrees)(bestTargetCartographic.longitude), (0,_math__WEBPACK_IMPORTED_MODULE_1__.toDegrees)(bestTargetCartographic.latitude)]));

    // resolution
    this.view_.setResolution(this.calcResolutionForDistance(this.distance_, bestTargetCartographic ? bestTargetCartographic.latitude : 0));

    /*
     * Since we are positioning the target, the values of heading and tilt
     * need to be calculated _at the target_.
     */
    if (target) {
      const pos = this.cam_.position;

      // normal to the ellipsoid at the target
      const targetNormal = new Cesium.Cartesian3();
      ellipsoid.geocentricSurfaceNormal(target, targetNormal);

      // vector from the target to the camera
      const targetToCamera = new Cesium.Cartesian3();
      Cesium.Cartesian3.subtract(pos, target, targetToCamera);
      Cesium.Cartesian3.normalize(targetToCamera, targetToCamera);

      // HEADING
      const up = this.cam_.up;
      const right = this.cam_.right;
      const normal = new Cesium.Cartesian3(-target.y, target.x, 0); // what is it?
      const heading = Cesium.Cartesian3.angleBetween(right, normal);
      const cross = Cesium.Cartesian3.cross(target, up, new Cesium.Cartesian3());
      const orientation = cross.z;
      this.view_.setRotation(orientation < 0 ? heading : -heading);

      // TILT
      const tiltAngle = Math.acos(Cesium.Cartesian3.dot(targetNormal, targetToCamera));
      this.tilt_ = isNaN(tiltAngle) ? 0 : tiltAngle;
    } else {
      // fallback when there is no target
      this.view_.setRotation(this.cam_.heading);
      this.tilt_ = -this.cam_.pitch + Math.PI / 2;
    }
    this.viewUpdateInProgress_ = false;
  }

  /**
   * Check if the underlying camera state has changed and ensure synchronization.
   * @param opt_dontSync Do not synchronize the view.
   */
  checkCameraChange(opt_dontSync) {
    const old = this.lastCameraViewMatrix_;
    const current = this.cam_.viewMatrix;
    if (!old || !Cesium.Matrix4.equalsEpsilon(old, current, 1e-7)) {
      this.lastCameraViewMatrix_ = current.clone();
      if (opt_dontSync !== true) {
        this.updateView();
      }
    }
  }

  /**
   * calculate the distance between camera and centerpoint based on the resolution and latitude value
   * @param resolution Number of map units per pixel.
   * @param latitude Latitude in radians.
   * @return The calculated distance.
   */
  calcDistanceForResolution(resolution, latitude) {
    return (0,_core__WEBPACK_IMPORTED_MODULE_3__.calcDistanceForResolution)(resolution, latitude, this.scene_, this.view_.getProjection());
  }

  /**
   * calculate the resolution based on a distance(camera to position) and latitude value
   * @param distance
   * @param latitude
   * @return} The calculated resolution.
   */
  calcResolutionForDistance(distance, latitude) {
    return (0,_core__WEBPACK_IMPORTED_MODULE_3__.calcResolutionForDistance)(distance, latitude, this.scene_, this.view_.getProjection());
  }
}

/***/ }),

/***/ "./src/olcs/FeatureConverter.ts":
/*!**************************************!*\
  !*** ./src/olcs/FeatureConverter.ts ***!
  \**************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ FeatureConverter)
/* harmony export */ });
/* harmony import */ var ol_style_Icon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ol/style/Icon.js */ "ol/style/Icon.js");
/* harmony import */ var ol_style_Icon_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(ol_style_Icon_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var ol_source_Vector_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ol/source/Vector.js */ "ol/source/Vector.js");
/* harmony import */ var ol_source_Vector_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(ol_source_Vector_js__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var ol_source_Cluster_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ol/source/Cluster.js */ "ol/source/Cluster.js");
/* harmony import */ var ol_source_Cluster_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(ol_source_Cluster_js__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var ol_geom_Polygon_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ol/geom/Polygon.js */ "ol/geom/Polygon.js");
/* harmony import */ var ol_geom_Polygon_js__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(ol_geom_Polygon_js__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var ol_extent_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ol/extent.js */ "ol/extent.js");
/* harmony import */ var ol_extent_js__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(ol_extent_js__WEBPACK_IMPORTED_MODULE_4__);
/* harmony import */ var ol_geom_SimpleGeometry_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ol/geom/SimpleGeometry.js */ "ol/geom/SimpleGeometry.js");
/* harmony import */ var ol_geom_SimpleGeometry_js__WEBPACK_IMPORTED_MODULE_5___default = /*#__PURE__*/__webpack_require__.n(ol_geom_SimpleGeometry_js__WEBPACK_IMPORTED_MODULE_5__);
/* harmony import */ var _core__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./core */ "./src/olcs/core.ts");
/* harmony import */ var _core_VectorLayerCounterpart__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./core/VectorLayerCounterpart */ "./src/olcs/core/VectorLayerCounterpart.ts");
/* harmony import */ var _util__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./util */ "./src/olcs/util.ts");
/* harmony import */ var ol_geom_js__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ol/geom.js */ "ol/geom.js");
/* harmony import */ var ol_geom_js__WEBPACK_IMPORTED_MODULE_9___default = /*#__PURE__*/__webpack_require__.n(ol_geom_js__WEBPACK_IMPORTED_MODULE_9__);










class FeatureConverter {
  /**
   * Concrete base class for converting from OpenLayers3 vectors to Cesium
   * primitives.
   * Extending this class is possible provided that the extending class and
   * the library are compiled together by the closure compiler.
   * @param scene Cesium scene.
   * @api
   */
  constructor(scene) {
    /**
     * Bind once to have a unique function for using as a listener
     */
    this.boundOnRemoveOrClearFeatureListener_ = this.onRemoveOrClearFeature_.bind(this);
    this.defaultBillboardEyeOffset_ = new Cesium.Cartesian3(0, 0, 10);
    this.scene = scene;
    this.scene = scene;
  }

  /**
   * @param evt
   */
  onRemoveOrClearFeature_(evt) {
    const source = evt.target;
    console.assert(source instanceof (ol_source_Vector_js__WEBPACK_IMPORTED_MODULE_1___default()));
    const cancellers = source['olcs_cancellers'];
    if (cancellers) {
      const feature = evt.feature;
      if (feature) {
        // remove
        const id = (0,_util__WEBPACK_IMPORTED_MODULE_8__.getUid)(feature);
        const canceller = cancellers[id];
        if (canceller) {
          canceller();
          delete cancellers[id];
        }
      } else {
        // clear
        for (const key in cancellers) {
          if (cancellers.hasOwnProperty(key)) {
            cancellers[key]();
          }
        }
        source['olcs_cancellers'] = {};
      }
    }
  }

  /**
   * @param layer
   * @param feature OpenLayers feature.
   * @param primitive
   */
  setReferenceForPicking(layer, feature, primitive) {
    primitive.olLayer = layer;
    primitive.olFeature = feature;
  }

  /**
   * Basics primitive creation using a color attribute.
   * Note that Cesium has 'interior' and outline geometries.
   * @param layer
   * @param feature OpenLayers feature.
   * @param olGeometry OpenLayers geometry.
   * @param geometry
   * @param color
   * @param opt_lineWidth
   * @return primitive
   */
  createColoredPrimitive(layer, feature, olGeometry, geometry, color, opt_lineWidth) {
    const createInstance = function (geometry, color) {
      const instance = new Cesium.GeometryInstance({
        geometry
      });
      if (color && !(color instanceof Cesium.ImageMaterialProperty)) {
        instance.attributes = {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(color)
        };
      }
      return instance;
    };
    const options = {
      flat: true,
      // work with all geometries
      renderState: {
        depthTest: {
          enabled: true
        }
      }
    };
    if (opt_lineWidth !== undefined) {
      options.renderState.lineWidth = opt_lineWidth;
    }
    const instances = createInstance(geometry, color);
    const heightReference = this.getHeightReference(layer, feature, olGeometry);
    let primitive;
    if (heightReference === Cesium.HeightReference.CLAMP_TO_GROUND) {
      if (!('createShadowVolume' in instances.geometry.constructor)) {
        // This is not a ground geometry
        return null;
      }
      primitive = new Cesium.GroundPrimitive({
        geometryInstances: instances
      });
    } else {
      primitive = new Cesium.Primitive({
        geometryInstances: instances
      });
    }
    if (color instanceof Cesium.ImageMaterialProperty) {
      // FIXME: we created stylings which are not time related
      // What should we pass here?
      // @ts-ignore
      const dataUri = color.image.getValue().toDataURL();
      primitive.appearance = new Cesium.MaterialAppearance({
        flat: true,
        renderState: {
          depthTest: {
            enabled: true
          }
        },
        material: new Cesium.Material({
          fabric: {
            type: 'Image',
            uniforms: {
              image: dataUri
            }
          }
        })
      });
    } else {
      primitive.appearance = new Cesium.MaterialAppearance({
        ...options,
        material: new Cesium.Material({
          translucent: color.alpha !== 1,
          fabric: {
            type: 'Color',
            uniforms: {
              color
            }
          }
        })
      });
      if (primitive instanceof Cesium.Primitive && (feature.get('olcs_shadows') || layer.get('olcs_shadows'))) {
        primitive.shadows = 1;
      }
    }
    this.setReferenceForPicking(layer, feature, primitive);
    return primitive;
  }

  /**
   * Return the fill or stroke color from a plain ol style.
   * @param style
   * @param outline
   * @return {!CSColor}
   */
  extractColorFromOlStyle(style, outline) {
    const fillColor = style.getFill() ? style.getFill().getColor() : null;
    const strokeColor = style.getStroke() ? style.getStroke().getColor() : null;
    let olColor = 'black';
    if (strokeColor && outline) {
      olColor = strokeColor;
    } else if (fillColor) {
      olColor = fillColor;
    }
    return (0,_core__WEBPACK_IMPORTED_MODULE_6__.convertColorToCesium)(olColor);
  }

  /**
   * Return the width of stroke from a plain ol style.
   * @param style
   * @return {number}
   */
  extractLineWidthFromOlStyle(style) {
    // Handling of line width WebGL limitations is handled by Cesium.
    const width = style.getStroke() ? style.getStroke().getWidth() : undefined;
    return width !== undefined ? width : 1;
  }

  /**
   * Create a primitive collection out of two Cesium geometries.
   * Only the OpenLayers style colors will be used.
   */
  wrapFillAndOutlineGeometries(layer, feature, olGeometry, fillGeometry, outlineGeometry, olStyle) {
    const fillColor = this.extractColorFromOlStyle(olStyle, false);
    const outlineColor = this.extractColorFromOlStyle(olStyle, true);
    const primitives = new Cesium.PrimitiveCollection();
    if (olStyle.getFill()) {
      const p1 = this.createColoredPrimitive(layer, feature, olGeometry, fillGeometry, fillColor);
      console.assert(!!p1);
      primitives.add(p1);
    }
    if (olStyle.getStroke() && outlineGeometry) {
      const width = this.extractLineWidthFromOlStyle(olStyle);
      const p2 = this.createColoredPrimitive(layer, feature, olGeometry, outlineGeometry, outlineColor, width);
      if (p2) {
        // Some outline geometries are not supported by Cesium in clamp to ground
        // mode. These primitives are skipped.
        primitives.add(p2);
      }
    }
    return primitives;
  }

  // Geometry converters

  // FIXME: would make more sense to only accept primitive collection.
  /**
   * Create a Cesium primitive if style has a text component.
   * Eventually return a PrimitiveCollection including current primitive.
   */
  addTextStyle(layer, feature, geometry, style, primitive) {
    let primitives;
    if (!(primitive instanceof Cesium.PrimitiveCollection)) {
      primitives = new Cesium.PrimitiveCollection();
      primitives.add(primitive);
    } else {
      primitives = primitive;
    }
    if (!style.getText()) {
      return primitives;
    }
    const text = /** @type {!ol.style.Text} */style.getText();
    const label = this.olGeometry4326TextPartToCesium(layer, feature, geometry, text);
    if (label) {
      primitives.add(label);
    }
    return primitives;
  }

  /**
   * Add a billboard to a Cesium.BillboardCollection.
   * Overriding this wrapper allows manipulating the billboard options.
   * @param billboards
   * @param bbOptions
   * @param layer
   * @param feature OpenLayers feature.
   * @param geometry
   * @param style
   * @return newly created billboard
   * @api
   */
  csAddBillboard(billboards, bbOptions, layer, feature, geometry, style) {
    if (!bbOptions.eyeOffset) {
      bbOptions.eyeOffset = this.defaultBillboardEyeOffset_;
    }
    const bb = billboards.add(bbOptions);
    this.setReferenceForPicking(layer, feature, bb);
    return bb;
  }

  /**
   * Convert an OpenLayers circle geometry to Cesium.
   * @api
   */
  olCircleGeometryToCesium(layer, feature, olGeometry, projection, olStyle) {
    olGeometry = (0,_core__WEBPACK_IMPORTED_MODULE_6__.olGeometryCloneTo4326)(olGeometry, projection);
    console.assert(olGeometry.getType() == 'Circle');

    // ol.Coordinate
    const olCenter = olGeometry.getCenter();
    const height = olCenter.length == 3 ? olCenter[2] : 0.0;
    const olPoint = olCenter.slice();
    olPoint[0] += olGeometry.getRadius();

    // Cesium
    const center = (0,_core__WEBPACK_IMPORTED_MODULE_6__.ol4326CoordinateToCesiumCartesian)(olCenter);
    const point = (0,_core__WEBPACK_IMPORTED_MODULE_6__.ol4326CoordinateToCesiumCartesian)(olPoint);

    // Accurate computation of straight distance
    const radius = Cesium.Cartesian3.distance(center, point);
    const fillGeometry = new Cesium.CircleGeometry({
      center,
      radius,
      height
    });
    let outlinePrimitive;
    let outlineGeometry;
    if (this.getHeightReference(layer, feature, olGeometry) === Cesium.HeightReference.CLAMP_TO_GROUND) {
      const width = this.extractLineWidthFromOlStyle(olStyle);
      if (width) {
        const circlePolygon = (0,ol_geom_Polygon_js__WEBPACK_IMPORTED_MODULE_3__.circular)(olGeometry.getCenter(), radius);
        const positions = (0,_core__WEBPACK_IMPORTED_MODULE_6__.ol4326CoordinateArrayToCsCartesians)(circlePolygon.getLinearRing(0).getCoordinates());
        const op = outlinePrimitive = new Cesium.GroundPolylinePrimitive({
          geometryInstances: new Cesium.GeometryInstance({
            geometry: new Cesium.GroundPolylineGeometry({
              positions,
              width
            })
          }),
          appearance: new Cesium.PolylineMaterialAppearance({
            material: this.olStyleToCesium(feature, olStyle, true)
          }),
          classificationType: Cesium.ClassificationType.TERRAIN
        });
        (0,_util__WEBPACK_IMPORTED_MODULE_8__.waitReady)(outlinePrimitive).then(() => {
          this.setReferenceForPicking(layer, feature, op._primitive);
        });
      }
    } else {
      outlineGeometry = new Cesium.CircleOutlineGeometry({
        center,
        radius,
        extrudedHeight: height,
        height
      });
    }
    const primitives = this.wrapFillAndOutlineGeometries(layer, feature, olGeometry, fillGeometry, outlineGeometry, olStyle);
    if (outlinePrimitive) {
      primitives.add(outlinePrimitive);
    }
    return this.addTextStyle(layer, feature, olGeometry, olStyle, primitives);
  }

  /**
   * Convert an OpenLayers line string geometry to Cesium.
   * @api
   */
  olLineStringGeometryToCesium(layer, feature, olGeometry, projection, olStyle) {
    olGeometry = (0,_core__WEBPACK_IMPORTED_MODULE_6__.olGeometryCloneTo4326)(olGeometry, projection);
    console.assert(olGeometry.getType() == 'LineString');
    const positions = (0,_core__WEBPACK_IMPORTED_MODULE_6__.ol4326CoordinateArrayToCsCartesians)(olGeometry.getCoordinates());
    const width = this.extractLineWidthFromOlStyle(olStyle);
    let outlinePrimitive;
    const heightReference = this.getHeightReference(layer, feature, olGeometry);
    const appearance = new Cesium.PolylineMaterialAppearance({
      material: this.olStyleToCesium(feature, olStyle, true)
    });
    if (heightReference === Cesium.HeightReference.CLAMP_TO_GROUND) {
      const geometry = new Cesium.GroundPolylineGeometry({
        positions,
        width
      });
      const op = outlinePrimitive = new Cesium.GroundPolylinePrimitive({
        appearance,
        geometryInstances: new Cesium.GeometryInstance({
          geometry
        })
      });
      (0,_util__WEBPACK_IMPORTED_MODULE_8__.waitReady)(outlinePrimitive).then(() => {
        this.setReferenceForPicking(layer, feature, op._primitive);
      });
    } else {
      const geometry = new Cesium.PolylineGeometry({
        positions,
        width,
        vertexFormat: appearance.vertexFormat
      });
      outlinePrimitive = new Cesium.Primitive({
        appearance,
        geometryInstances: new Cesium.GeometryInstance({
          geometry
        })
      });
    }
    this.setReferenceForPicking(layer, feature, outlinePrimitive);
    return this.addTextStyle(layer, feature, olGeometry, olStyle, outlinePrimitive);
  }

  /**
   * Convert an OpenLayers polygon geometry to Cesium.
   * @api
   */
  olPolygonGeometryToCesium(layer, feature, olGeometry, projection, olStyle) {
    olGeometry = (0,_core__WEBPACK_IMPORTED_MODULE_6__.olGeometryCloneTo4326)(olGeometry, projection);
    console.assert(olGeometry.getType() == 'Polygon');
    const heightReference = this.getHeightReference(layer, feature, olGeometry);
    let fillGeometry, outlineGeometry;
    let outlinePrimitive;
    if (olGeometry.getCoordinates()[0].length == 5 && feature.get('olcs.polygon_kind') === 'rectangle') {
      // Create a rectangle according to the longitude and latitude curves
      const coordinates = olGeometry.getCoordinates()[0];
      // Extract the West, South, East, North coordinates
      const extent = (0,ol_extent_js__WEBPACK_IMPORTED_MODULE_4__.boundingExtent)(coordinates);
      const rectangle = Cesium.Rectangle.fromDegrees(extent[0], extent[1], extent[2], extent[3]);

      // Extract the average height of the vertices
      let maxHeight = 0.0;
      if (coordinates[0].length == 3) {
        for (let c = 0; c < coordinates.length; c++) {
          maxHeight = Math.max(maxHeight, coordinates[c][2]);
        }
      }
      const featureExtrudedHeight = feature.get('olcs_extruded_height');

      // Render the cartographic rectangle
      fillGeometry = new Cesium.RectangleGeometry({
        ellipsoid: Cesium.Ellipsoid.WGS84,
        rectangle,
        height: maxHeight,
        extrudedHeight: featureExtrudedHeight
      });
      outlineGeometry = new Cesium.RectangleOutlineGeometry({
        ellipsoid: Cesium.Ellipsoid.WGS84,
        rectangle,
        height: maxHeight,
        extrudedHeight: featureExtrudedHeight
      });
    } else {
      const rings = olGeometry.getLinearRings();
      const hierarchy = {
        positions: [],
        holes: []
      };
      const polygonHierarchy = hierarchy;
      console.assert(rings.length > 0);
      for (let i = 0; i < rings.length; ++i) {
        const olPos = rings[i].getCoordinates();
        const positions = (0,_core__WEBPACK_IMPORTED_MODULE_6__.ol4326CoordinateArrayToCsCartesians)(olPos);
        console.assert(positions && positions.length > 0);
        if (i === 0) {
          hierarchy.positions = positions;
        } else {
          hierarchy.holes.push({
            positions,
            holes: []
          });
        }
      }
      const featureExtrudedHeight = feature.get('olcs_extruded_height');
      fillGeometry = new Cesium.PolygonGeometry({
        polygonHierarchy,
        perPositionHeight: true,
        extrudedHeight: featureExtrudedHeight
      });

      // Since Cesium doesn't yet support Polygon outlines on terrain yet (coming soon...?)
      // we don't create an outline geometry if clamped, but instead do the polyline method
      // for each ring. Most of this code should be removeable when Cesium adds
      // support for Polygon outlines on terrain.
      if (heightReference === Cesium.HeightReference.CLAMP_TO_GROUND) {
        const width = this.extractLineWidthFromOlStyle(olStyle);
        if (width > 0) {
          const positions = [hierarchy.positions];
          if (hierarchy.holes) {
            for (let i = 0; i < hierarchy.holes.length; ++i) {
              positions.push(hierarchy.holes[i].positions);
            }
          }
          const appearance = new Cesium.PolylineMaterialAppearance({
            material: this.olStyleToCesium(feature, olStyle, true)
          });
          const geometryInstances = [];
          for (const linePositions of positions) {
            const polylineGeometry = new Cesium.GroundPolylineGeometry({
              positions: linePositions,
              width
            });
            geometryInstances.push(new Cesium.GeometryInstance({
              geometry: polylineGeometry
            }));
          }
          outlinePrimitive = new Cesium.GroundPolylinePrimitive({
            appearance,
            geometryInstances
          });
          (0,_util__WEBPACK_IMPORTED_MODULE_8__.waitReady)(outlinePrimitive).then(() => {
            this.setReferenceForPicking(layer, feature, outlinePrimitive._primitive);
          });
        }
      } else {
        // Actually do the normal polygon thing. This should end the removable
        // section of code described above.
        outlineGeometry = new Cesium.PolygonOutlineGeometry({
          polygonHierarchy: hierarchy,
          perPositionHeight: true,
          extrudedHeight: featureExtrudedHeight
        });
      }
    }
    const primitives = this.wrapFillAndOutlineGeometries(layer, feature, olGeometry, fillGeometry, outlineGeometry, olStyle);
    if (outlinePrimitive) {
      primitives.add(outlinePrimitive);
    }
    return this.addTextStyle(layer, feature, olGeometry, olStyle, primitives);
  }

  /**
   * @api
   */
  getHeightReference(layer, feature, geometry) {
    // Read from the geometry
    let altitudeMode = geometry.get('altitudeMode');

    // Or from the feature
    if (altitudeMode === undefined) {
      altitudeMode = feature.get('altitudeMode');
    }

    // Or from the layer
    if (altitudeMode === undefined) {
      altitudeMode = layer.get('altitudeMode');
    }
    let heightReference = Cesium.HeightReference.NONE;
    if (altitudeMode === 'clampToGround') {
      heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
    } else if (altitudeMode === 'relativeToGround') {
      heightReference = Cesium.HeightReference.RELATIVE_TO_GROUND;
    }
    return heightReference;
  }

  /**
   * Convert a point geometry to a Cesium BillboardCollection.
   * @param {ol.layer.Vector|ol.layer.Image} layer
   * @param {!ol.Feature} feature OpenLayers feature..
   * @param {!ol.geom.Point} olGeometry OpenLayers point geometry.
   * @param {!ol.ProjectionLike} projection
   * @param {!ol.style.Style} style
   * @param {!ol.style.Image} imageStyle
   * @param {!Cesium.BillboardCollection} billboards
   * @param {function(!Cesium.Billboard)=} opt_newBillboardCallback Called when the new billboard is added.
   * @api
   */
  createBillboardFromImage(layer, feature, olGeometry, projection, style, imageStyle, billboards, opt_newBillboardCallback) {
    if (imageStyle instanceof (ol_style_Icon_js__WEBPACK_IMPORTED_MODULE_0___default())) {
      // make sure the image is scheduled for load
      imageStyle.load();
    }
    const image = imageStyle.getImage(1); // get normal density
    const isImageLoaded = function (image) {
      return image.src != '' && image.naturalHeight != 0 && image.naturalWidth != 0 && image.complete;
    };
    const reallyCreateBillboard = function () {
      if (!image) {
        return;
      }
      if (!(image instanceof HTMLCanvasElement || image instanceof Image || image instanceof HTMLImageElement)) {
        return;
      }
      const center = olGeometry.getCoordinates();
      const position = (0,_core__WEBPACK_IMPORTED_MODULE_6__.ol4326CoordinateToCesiumCartesian)(center);
      let color;
      const opacity = imageStyle.getOpacity();
      if (opacity !== undefined) {
        color = new Cesium.Color(1.0, 1.0, 1.0, opacity);
      }
      const scale = imageStyle.getScale();
      const heightReference = this.getHeightReference(layer, feature, olGeometry);
      const bbOptions = {
        image,
        color,
        scale,
        heightReference,
        position
      };

      // merge in cesium options from openlayers feature
      Object.assign(bbOptions, feature.get('cesiumOptions'));
      if (imageStyle instanceof (ol_style_Icon_js__WEBPACK_IMPORTED_MODULE_0___default())) {
        const anchor = imageStyle.getAnchor();
        if (anchor) {
          const xScale = Array.isArray(scale) ? scale[0] : scale;
          const yScale = Array.isArray(scale) ? scale[1] : scale;
          bbOptions.pixelOffset = new Cesium.Cartesian2((image.width / 2 - anchor[0]) * xScale, (image.height / 2 - anchor[1]) * yScale);
        }
      }
      const bb = this.csAddBillboard(billboards, bbOptions, layer, feature, olGeometry, style);
      if (opt_newBillboardCallback) {
        opt_newBillboardCallback(bb);
      }
    }.bind(this);
    if (image instanceof Image && !isImageLoaded(image)) {
      // Cesium requires the image to be loaded
      let cancelled = false;
      const source = layer.getSource();
      const canceller = function () {
        cancelled = true;
      };
      source.on(['removefeature', 'clear'], this.boundOnRemoveOrClearFeatureListener_);
      let cancellers = source['olcs_cancellers'];
      if (!cancellers) {
        cancellers = source['olcs_cancellers'] = {};
      }
      const fuid = (0,_util__WEBPACK_IMPORTED_MODULE_8__.getUid)(feature);
      if (cancellers[fuid]) {
        // When the feature change quickly, a canceller may still be present so
        // we cancel it here to prevent creation of a billboard.
        cancellers[fuid]();
      }
      cancellers[fuid] = canceller;
      const listener = function () {
        image.removeEventListener('load', listener);
        if (!billboards.isDestroyed() && !cancelled) {
          // Create billboard if the feature is still displayed on the map.
          reallyCreateBillboard();
        }
      };
      image.addEventListener('load', listener);
    } else {
      reallyCreateBillboard();
    }
  }

  /**
   * Convert a point geometry to a Cesium BillboardCollection.
   * @param layer
   * @param feature OpenLayers feature..
   * @param olGeometry OpenLayers point geometry.
   * @param projection
   * @param style
   * @param billboards
   * @param opt_newBillboardCallback Called when the new billboard is added.
   * @return primitives
   * @api
   */
  olPointGeometryToCesium(layer, feature, olGeometry, projection, style, billboards, opt_newBillboardCallback) {
    console.assert(olGeometry.getType() == 'Point');
    olGeometry = (0,_core__WEBPACK_IMPORTED_MODULE_6__.olGeometryCloneTo4326)(olGeometry, projection);
    let modelPrimitive = null;
    const imageStyle = style.getImage();
    if (imageStyle) {
      const olcsModelFunction = olGeometry.get('olcs_model') || feature.get('olcs_model');
      if (olcsModelFunction) {
        modelPrimitive = new Cesium.PrimitiveCollection();
        const olcsModel = olcsModelFunction();
        const options = Object.assign({}, {
          scene: this.scene
        }, olcsModel.cesiumOptions);
        if ('fromGltf' in Cesium.Model) {
          // pre Cesium v107
          // @ts-ignore
          const model = Cesium.Model.fromGltf(options);
          modelPrimitive.add(model);
        } else {
          Cesium.Model.fromGltfAsync(options).then(model => {
            modelPrimitive.add(model);
          });
        }
        if (olcsModel.debugModelMatrix) {
          modelPrimitive.add(new Cesium.DebugModelMatrixPrimitive({
            modelMatrix: olcsModel.debugModelMatrix
          }));
        }
      } else {
        this.createBillboardFromImage(layer, feature, olGeometry, projection, style, imageStyle, billboards, opt_newBillboardCallback);
      }
    }
    if (style.getText()) {
      return this.addTextStyle(layer, feature, olGeometry, style, modelPrimitive || new Cesium.Primitive());
    } else {
      return modelPrimitive;
    }
  }

  /**
   * Convert an OpenLayers multi-something geometry to Cesium.
   * @param {ol.layer.Vector|ol.layer.Image} layer
   * @param {!ol.Feature} feature OpenLayers feature..
   * @param {!ol.geom.Geometry} geometry OpenLayers geometry.
   * @param {!ol.ProjectionLike} projection
   * @param {!ol.style.Style} olStyle
   * @param {!Cesium.BillboardCollection} billboards
   * @param {function(!Cesium.Billboard)=} opt_newBillboardCallback Called when
   * the new billboard is added.
   * @return {Cesium.Primitive} primitives
   * @api
   */
  olMultiGeometryToCesium(layer, feature, geometry, projection, olStyle, billboards, opt_newBillboardCallback) {
    // Do not reproject to 4326 now because it will be done later.

    switch (geometry.getType()) {
      case 'MultiPoint':
        {
          const points = geometry.getPoints();
          if (olStyle.getText()) {
            const primitives = new Cesium.PrimitiveCollection();
            points.forEach(geom => {
              console.assert(geom);
              const result = this.olPointGeometryToCesium(layer, feature, geom, projection, olStyle, billboards, opt_newBillboardCallback);
              if (result) {
                primitives.add(result);
              }
            });
            return primitives;
          } else {
            points.forEach(geom => {
              console.assert(geom);
              this.olPointGeometryToCesium(layer, feature, geom, projection, olStyle, billboards, opt_newBillboardCallback);
            });
            return null;
          }
        }
      case 'MultiLineString':
        {
          const lineStrings = geometry.getLineStrings();
          // FIXME: would be better to combine all child geometries in one primitive
          // instead we create n primitives for simplicity.
          const primitives = new Cesium.PrimitiveCollection();
          lineStrings.forEach(geom => {
            const p = this.olLineStringGeometryToCesium(layer, feature, geom, projection, olStyle);
            primitives.add(p);
          });
          return primitives;
        }
      case 'MultiPolygon':
        {
          const polygons = geometry.getPolygons();
          // FIXME: would be better to combine all child geometries in one primitive
          // instead we create n primitives for simplicity.
          const primitives = new Cesium.PrimitiveCollection();
          polygons.forEach(geom => {
            const p = this.olPolygonGeometryToCesium(layer, feature, geom, projection, olStyle);
            primitives.add(p);
          });
          return primitives;
        }
      default:
        console.assert(false, `Unhandled multi geometry type${geometry.getType()}`);
    }
  }

  /**
   * Convert an OpenLayers text style to Cesium.
   * @api
   */
  olGeometry4326TextPartToCesium(layer, feature, geometry, style) {
    const text = style.getText();
    if (!text) {
      return null;
    }
    const labels = new Cesium.LabelCollection({
      scene: this.scene
    });
    // TODO: export and use the text draw position from OpenLayers .
    // See src/ol/render/vector.js
    const extentCenter = (0,ol_extent_js__WEBPACK_IMPORTED_MODULE_4__.getCenter)(geometry.getExtent());
    if (geometry instanceof (ol_geom_SimpleGeometry_js__WEBPACK_IMPORTED_MODULE_5___default())) {
      const first = geometry.getFirstCoordinate();
      extentCenter[2] = first.length == 3 ? first[2] : 0.0;
    }
    const options = {};
    options.position = (0,_core__WEBPACK_IMPORTED_MODULE_6__.ol4326CoordinateToCesiumCartesian)(extentCenter);
    options.text = text;
    options.heightReference = this.getHeightReference(layer, feature, geometry);
    const offsetX = style.getOffsetX();
    const offsetY = style.getOffsetY();
    if (offsetX != 0 || offsetY != 0) {
      const offset = new Cesium.Cartesian2(offsetX, offsetY);
      options.pixelOffset = offset;
    }
    options.font = style.getFont() || '10px sans-serif'; // OpenLayers default

    let labelStyle = undefined;
    if (style.getFill()) {
      options.fillColor = this.extractColorFromOlStyle(style, false);
      labelStyle = Cesium.LabelStyle.FILL;
    }
    if (style.getStroke()) {
      options.outlineWidth = this.extractLineWidthFromOlStyle(style);
      options.outlineColor = this.extractColorFromOlStyle(style, true);
      labelStyle = Cesium.LabelStyle.OUTLINE;
    }
    if (style.getFill() && style.getStroke()) {
      labelStyle = Cesium.LabelStyle.FILL_AND_OUTLINE;
    }
    options.style = labelStyle;
    let horizontalOrigin;
    switch (style.getTextAlign()) {
      case 'left':
        horizontalOrigin = Cesium.HorizontalOrigin.LEFT;
        break;
      case 'right':
        horizontalOrigin = Cesium.HorizontalOrigin.RIGHT;
        break;
      case 'center':
      default:
        horizontalOrigin = Cesium.HorizontalOrigin.CENTER;
    }
    options.horizontalOrigin = horizontalOrigin;
    if (style.getTextBaseline()) {
      let verticalOrigin;
      switch (style.getTextBaseline()) {
        case 'top':
          verticalOrigin = Cesium.VerticalOrigin.TOP;
          break;
        case 'middle':
          verticalOrigin = Cesium.VerticalOrigin.CENTER;
          break;
        case 'bottom':
          verticalOrigin = Cesium.VerticalOrigin.BOTTOM;
          break;
        case 'alphabetic':
          verticalOrigin = Cesium.VerticalOrigin.TOP;
          break;
        case 'hanging':
          verticalOrigin = Cesium.VerticalOrigin.BOTTOM;
          break;
        default:
          console.assert(false, `unhandled baseline ${style.getTextBaseline()}`);
      }
      options.verticalOrigin = verticalOrigin;
    }
    const l = labels.add(options);
    this.setReferenceForPicking(layer, feature, l);
    return labels;
  }

  /**
   * Convert an OpenLayers style to a Cesium Material.
   * @api
   */
  olStyleToCesium(feature, style, outline) {
    const fill = style.getFill();
    const stroke = style.getStroke();
    if (outline && !stroke || !outline && !fill) {
      return null; // FIXME use a default style? Developer error?
    }
    const olColor = outline ? stroke.getColor() : fill.getColor();
    const color = (0,_core__WEBPACK_IMPORTED_MODULE_6__.convertColorToCesium)(olColor);
    if (outline && stroke.getLineDash()) {
      return Cesium.Material.fromType('Stripe', {
        horizontal: false,
        repeat: 500,
        // TODO how to calculate this?
        evenColor: color,
        oddColor: new Cesium.Color(0, 0, 0, 0) // transparent
      });
    } else {
      return Cesium.Material.fromType('Color', {
        color
      });
    }
  }

  /**
   * Compute OpenLayers plain style.
   * Evaluates style function, blend arrays, get default style.
   * @api
   */
  computePlainStyle(layer, feature, fallbackStyleFunction, resolution) {
    /**
     * @type {ol.FeatureStyleFunction|undefined}
     */
    const featureStyleFunction = feature.getStyleFunction();

    /**
     * @type {ol.style.Style|Array.<ol.style.Style>}
     */
    let style = null;
    if (featureStyleFunction) {
      style = featureStyleFunction(feature, resolution);
    }
    if (!style && fallbackStyleFunction) {
      style = fallbackStyleFunction(feature, resolution);
    }
    if (!style) {
      // The feature must not be displayed
      return null;
    }

    // FIXME combine materials as in cesium-materials-pack?
    // then this function must return a custom material
    // More simply, could blend the colors like described in
    // http://en.wikipedia.org/wiki/Alpha_compositing
    return Array.isArray(style) ? style : [style];
  }

  /**
   */
  getGeometryFromFeature(feature, style, opt_geom) {
    if (opt_geom) {
      return opt_geom;
    }
    const geom3d = feature.get('olcs.3d_geometry');
    if (geom3d && geom3d instanceof ol_geom_js__WEBPACK_IMPORTED_MODULE_9__.Geometry) {
      return geom3d;
    }
    if (style) {
      const geomFuncRes = style.getGeometryFunction()(feature);
      if (geomFuncRes instanceof ol_geom_js__WEBPACK_IMPORTED_MODULE_9__.Geometry) {
        return geomFuncRes;
      }
    }
    return feature.getGeometry();
  }

  /**
   * Convert one OpenLayers feature up to a collection of Cesium primitives.
   * @api
   */
  olFeatureToCesium(layer, feature, style, context, opt_geom) {
    const geom = this.getGeometryFromFeature(feature, style, opt_geom);
    if (!geom) {
      // OpenLayers features may not have a geometry
      // See http://geojson.org/geojson-spec.html#feature-objects
      return null;
    }
    const proj = context.projection;
    const newBillboardAddedCallback = function (bb) {
      const featureBb = context.featureToCesiumMap[(0,_util__WEBPACK_IMPORTED_MODULE_8__.getUid)(feature)];
      if (featureBb instanceof Array) {
        featureBb.push(bb);
      } else {
        context.featureToCesiumMap[(0,_util__WEBPACK_IMPORTED_MODULE_8__.getUid)(feature)] = [bb];
      }
    };
    switch (geom.getType()) {
      case 'GeometryCollection':
        const primitives = new Cesium.PrimitiveCollection();
        geom.getGeometriesArray().forEach(geom => {
          if (geom) {
            const prims = this.olFeatureToCesium(layer, feature, style, context, geom);
            if (prims) {
              primitives.add(prims);
            }
          }
        });
        return primitives;
      case 'Point':
        const bbs = context.billboards;
        const result = this.olPointGeometryToCesium(layer, feature, geom, proj, style, bbs, newBillboardAddedCallback);
        if (!result) {
          // no wrapping primitive
          return null;
        } else {
          return result;
        }
      case 'Circle':
        return this.olCircleGeometryToCesium(layer, feature, geom, proj, style);
      case 'LineString':
        return this.olLineStringGeometryToCesium(layer, feature, geom, proj, style);
      case 'Polygon':
        return this.olPolygonGeometryToCesium(layer, feature, geom, proj, style);
      case 'MultiPoint':
        return this.olMultiGeometryToCesium(layer, feature, geom, proj, style, context.billboards, newBillboardAddedCallback) || null;
      case 'MultiLineString':
        return this.olMultiGeometryToCesium(layer, feature, geom, proj, style, context.billboards, newBillboardAddedCallback) || null;
      case 'MultiPolygon':
        return this.olMultiGeometryToCesium(layer, feature, geom, proj, style, context.billboards, newBillboardAddedCallback) || null;
      case 'LinearRing':
        throw new Error('LinearRing should only be part of polygon.');
      default:
        throw new Error(`Ol geom type not handled : ${geom.getType()}`);
    }
  }

  /**
   * Convert an OpenLayers vector layer to Cesium primitive collection.
   * For each feature, the associated primitive will be stored in
   * `featurePrimitiveMap`.
   * @api
   */
  olVectorLayerToCesium(olLayer, olView, featurePrimitiveMap) {
    const proj = olView.getProjection();
    const resolution = olView.getResolution();
    if (resolution === undefined || !proj) {
      console.assert(false, 'View not ready');
      // an assertion is not enough for closure to assume resolution and proj
      // are defined
      throw new Error('View not ready');
    }
    let source = olLayer.getSource();
    if (source instanceof (ol_source_Cluster_js__WEBPACK_IMPORTED_MODULE_2___default())) {
      source = source.getSource();
    }
    console.assert(source instanceof (ol_source_Vector_js__WEBPACK_IMPORTED_MODULE_1___default()));
    const features = source.getFeatures();
    const counterpart = new _core_VectorLayerCounterpart__WEBPACK_IMPORTED_MODULE_7__["default"](proj, this.scene);
    const context = counterpart.context;
    for (let i = 0; i < features.length; ++i) {
      const feature = features[i];
      if (!feature) {
        continue;
      }
      const layerStyle = olLayer.getStyleFunction();
      const styles = this.computePlainStyle(olLayer, feature, layerStyle, resolution);
      if (!styles || !styles.length) {
        // only 'render' features with a style
        continue;
      }
      let primitives = null;
      for (let i = 0; i < styles.length; i++) {
        const prims = this.olFeatureToCesium(olLayer, feature, styles[i], context);
        if (prims) {
          if (!primitives) {
            primitives = prims;
          } else if (prims) {
            let i = 0,
              prim;
            while (prim = prims.get(i)) {
              primitives.add(prim);
              i++;
            }
          }
        }
      }
      if (!primitives) {
        continue;
      }
      featurePrimitiveMap[(0,_util__WEBPACK_IMPORTED_MODULE_8__.getUid)(feature)] = primitives;
      counterpart.getRootPrimitive().add(primitives);
    }
    return counterpart;
  }

  /**
   * Convert an OpenLayers feature to Cesium primitive collection.
   * @api
   */
  convert(layer, view, feature, context) {
    const proj = view.getProjection();
    const resolution = view.getResolution();
    if (resolution == undefined || !proj) {
      return null;
    }

    /**
     * @type {ol.StyleFunction|undefined}
     */
    const layerStyle = layer.getStyleFunction();
    const styles = this.computePlainStyle(layer, feature, layerStyle, resolution);
    if (!styles || !styles.length) {
      // only 'render' features with a style
      return null;
    }
    context.projection = proj;

    /**
     * @type {Cesium.Primitive|null}
     */
    let primitives = null;
    for (let i = 0; i < styles.length; i++) {
      const prims = this.olFeatureToCesium(layer, feature, styles[i], context);
      if (!primitives) {
        primitives = prims;
      } else if (prims) {
        let i = 0,
          prim;
        while (prim = prims.get(i)) {
          primitives.add(prim);
          i++;
        }
      }
    }
    return primitives;
  }
}

/***/ }),

/***/ "./src/olcs/MVTImageryProvider.ts":
/*!****************************************!*\
  !*** ./src/olcs/MVTImageryProvider.ts ***!
  \****************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ MVTImageryProvider)
/* harmony export */ });
/* harmony import */ var ol_format_MVT_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ol/format/MVT.js */ "ol/format/MVT.js");
/* harmony import */ var ol_format_MVT_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(ol_format_MVT_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var ol_style_Style_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ol/style/Style.js */ "ol/style/Style.js");
/* harmony import */ var ol_style_Style_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(ol_style_Style_js__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var ol_style_Stroke_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ol/style/Stroke.js */ "ol/style/Stroke.js");
/* harmony import */ var ol_style_Stroke_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(ol_style_Stroke_js__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var ol_render_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ol/render.js */ "ol/render.js");
/* harmony import */ var ol_render_js__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(ol_render_js__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var ol_proj_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ol/proj.js */ "ol/proj.js");
/* harmony import */ var ol_proj_js__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(ol_proj_js__WEBPACK_IMPORTED_MODULE_4__);
/* harmony import */ var ol_util_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ol/util.js */ "ol/util.js");
/* harmony import */ var ol_util_js__WEBPACK_IMPORTED_MODULE_5___default = /*#__PURE__*/__webpack_require__.n(ol_util_js__WEBPACK_IMPORTED_MODULE_5__);
/* harmony import */ var ol_structs_LRUCache_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ol/structs/LRUCache.js */ "ol/structs/LRUCache.js");
/* harmony import */ var ol_structs_LRUCache_js__WEBPACK_IMPORTED_MODULE_6___default = /*#__PURE__*/__webpack_require__.n(ol_structs_LRUCache_js__WEBPACK_IMPORTED_MODULE_6__);
/* harmony import */ var ol_tilegrid_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ol/tilegrid.js */ "ol/tilegrid.js");
/* harmony import */ var ol_tilegrid_js__WEBPACK_IMPORTED_MODULE_7___default = /*#__PURE__*/__webpack_require__.n(ol_tilegrid_js__WEBPACK_IMPORTED_MODULE_7__);
/* harmony import */ var ol_tileurlfunction_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ol/tileurlfunction.js */ "ol/tileurlfunction.js");
/* harmony import */ var ol_tileurlfunction_js__WEBPACK_IMPORTED_MODULE_8___default = /*#__PURE__*/__webpack_require__.n(ol_tileurlfunction_js__WEBPACK_IMPORTED_MODULE_8__);
/* harmony import */ var ol_render_Feature_js__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ol/render/Feature.js */ "ol/render/Feature.js");
/* harmony import */ var ol_render_Feature_js__WEBPACK_IMPORTED_MODULE_9___default = /*#__PURE__*/__webpack_require__.n(ol_render_Feature_js__WEBPACK_IMPORTED_MODULE_9__);
/* harmony import */ var _core_OLImageryProvider__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! ./core/OLImageryProvider */ "./src/olcs/core/OLImageryProvider.ts");











const format = new (ol_format_MVT_js__WEBPACK_IMPORTED_MODULE_0___default())({
  featureClass: (typeof ol !== 'undefined' && ol.Feature) ? ol.Feature : (ol_render_Feature_js__WEBPACK_IMPORTED_MODULE_9___default()),
  layerName: '_mvtLayer_'
});
const styles = [new (ol_style_Style_js__WEBPACK_IMPORTED_MODULE_1___default())({
  stroke: new (ol_style_Stroke_js__WEBPACK_IMPORTED_MODULE_2___default())({
    color: 'blue',
    width: 2
  })
})];
class MVTImageryProvider {
  get minimumLevel() {
    return this.minimumLevel_;
  }
  /**
  * When <code>true</code>, this model is ready to render, i.e., the external binary, image,
  * and shader files were downloaded and the WebGL resources were created.
  */
  get ready() {
    return this.ready_;
  }

  /**
  * Gets the rectangle, in radians, of the imagery provided by the instance.
  */
  get rectangle() {
    return this.rectangle_;
  }

  /**
   * Gets the tiling scheme used by the provider.
   */
  get tilingScheme() {
    return this.tilingScheme_;
  }

  /**
   * Gets an event that is raised when the imagery provider encounters an asynchronous error.  By subscribing
   * to the event, you will be notified of the error and can potentially recover from it.  Event listeners
   * are passed an instance of {@link Cesium.TileProviderError}.
   */

  /**
   * Gets the credit to display when this imagery provider is active.  Typically this is used to credit
   * the source of the imagery.
   */

  getTileCredits(x, y, level) {
    return [];
  }

  /**
   * Gets the proxy used by this provider.
   */

  get _ready() {
    return this.ready_;
  }

  /**
   * Gets the tile discard policy.  If not undefined, the discard policy is responsible
   * for filtering out "missing" tiles via its shouldDiscardImage function.  If this function
   * returns undefined, no tiles are filtered.
   */
  get tileDiscardPolicy() {
    return undefined;
  }

  // FIXME: this might be exposed
  /**
   * Gets a value indicating whether or not the images provided by this imagery provider
   * include an alpha channel.  If this property is false, an alpha channel, if present, will
   * be ignored.  If this property is true, any images without an alpha channel will be treated
   * as if their alpha is 1.0 everywhere.  When this property is false, memory usage
   * and texture upload time are reduced.
   */
  get hasAlphaChannel() {
    return true;
  }

  // FIXME: this could be implemented by proxying to OL
  /**
   * Asynchronously determines what features, if any, are located at a given longitude and latitude within
   * a tile.
   * This function is optional, so it may not exist on all ImageryProviders.
   * @param x - The tile X coordinate.
   * @param y - The tile Y coordinate.
   * @param level - The tile level.
   * @param longitude - The longitude at which to pick features.
   * @param latitude - The latitude at which to pick features.
   * @return A promise for the picked features that will resolve when the asynchronous
   *                   picking completes.  The resolved value is an array of {@link ImageryLayerFeatureInfo}
   *                   instances.  The array may be empty if no features are found at the given location.
   *                   It may also be undefined if picking is not supported.
   */
  pickFeatures(x, y, level, longitude, latitude) {
    return undefined;
  }
  constructor(options) {
    this.emptyCanvas_ = (0,_core_OLImageryProvider__WEBPACK_IMPORTED_MODULE_10__.createEmptyCanvas)();
    this.emptyCanvasPromise_ = Promise.resolve(this.emptyCanvas_);
    this.tilingScheme_ = new Cesium.WebMercatorTilingScheme();
    this.ready_ = true;
    this.tileWidth = 256;
    this.tileHeight = 256;
    this.maximumLevel = 20;
    this.minimumLevel_ = 0;
    this.projection_ = (0,ol_proj_js__WEBPACK_IMPORTED_MODULE_4__.get)('EPSG:3857');
    this.errorEvent = new Cesium.Event();
    this.urls = options.urls;
    this.rectangle_ = options.rectangle || this.tilingScheme.rectangle;
    this.credit = options.credit;
    this.styleFunction_ = options.styleFunction || (() => styles);
    this.tileRectangle_ = new Cesium.Rectangle();
    // to avoid too frequent cache grooming we allow x2 capacity
    const cacheSize = options.cacheSize !== undefined ? options.cacheSize : 50;
    this.tileCache = new (ol_structs_LRUCache_js__WEBPACK_IMPORTED_MODULE_6___default())(cacheSize);
    this.featureCache = options.featureCache || new (ol_structs_LRUCache_js__WEBPACK_IMPORTED_MODULE_6___default())(cacheSize);
    this.minimumLevel_ = options.minimumLevel || 0;
    const tileGrid = (0,ol_tilegrid_js__WEBPACK_IMPORTED_MODULE_7__.getForProjection)(this.projection_);
    this.tileFunction_ = (0,ol_tileurlfunction_js__WEBPACK_IMPORTED_MODULE_8__.createFromTemplates)(this.urls, tileGrid);
  }
  getTileFeatures(z, x, y) {
    const cacheKey = this.getCacheKey_(z, x, y);
    let promise;
    if (this.featureCache.containsKey(cacheKey)) {
      promise = this.featureCache.get(cacheKey);
    }
    if (!promise) {
      const url = this.getUrl_(z, x, y);
      promise = fetch(url).then(r => r.ok ? r : Promise.reject(r)).then(r => r.arrayBuffer()).then(buffer => this.readFeaturesFromBuffer(buffer));
      this.featureCache.set(cacheKey, promise);
      if (this.featureCache.getCount() > 2 * this.featureCache.highWaterMark) {
        while (this.featureCache.canExpireCache()) {
          this.featureCache.pop();
        }
      }
    }
    return promise;
  }
  readFeaturesFromBuffer(buffer) {
    let options;
/*     if (ol_util_js__WEBPACK_IMPORTED_MODULE_5__.VERSION <= '6.4.4') {
      // See https://github.com/openlayers/openlayers/pull/11540
      options = {
        extent: [0, 0, 4096, 4096],
        dataProjection: this.projection_,
        featureProjection: this.projection_
      };
    } */
    const features = format.readFeatures(buffer, options);
    const scaleFactor = this.tileWidth / 4096;
    features.forEach(f => {
      const geomOrFeature = f.getGeometry ? f.getGeometry() : f;
      const flatCoordinates = geomOrFeature.getFlatCoordinates();
      let flip = false;
      for (let i = 0; i < flatCoordinates.length; ++i) {
        flatCoordinates[i] *= scaleFactor;
        if (flip) {
          // FIXME: why do we need this now?
          flatCoordinates[i] = this.tileWidth - flatCoordinates[i];
        }
/*         if (ol_util_js__WEBPACK_IMPORTED_MODULE_5__.VERSION <= '6.4.4') {
          // LEGACY
          flip = !flip;
        } */
      }
    });
    return features;
  }
  getUrl_(z, x, y) {
    // FIXME: probably we should not pass 1 as pixelRatio
    const url = this.tileFunction_([z, x, y], 1, this.projection_);
    return url;
  }
  getCacheKey_(z, x, y) {
    return `${z}_${x}_${y}`;
  }
  requestImage(x, y, z, request) {
    if (z < this.minimumLevel_ || z > this.maximumLevel) {
      return this.emptyCanvasPromise_;
    }
    try {
      const cacheKey = this.getCacheKey_(z, x, y);
      let promise;
      if (this.tileCache.containsKey(cacheKey)) {
        promise = this.tileCache.get(cacheKey);
      }
      if (!promise) {
        promise = this.getTileFeatures(z, x, y).then(features => {
          // FIXME: here we suppose the 2D projection is in meters
          this.tilingScheme.tileXYToNativeRectangle(x, y, z, this.tileRectangle_);
          const resolution = (this.tileRectangle_.east - this.tileRectangle_.west) / this.tileWidth;
          return this.rasterizeFeatures(features, this.styleFunction_, resolution);
        }).catch(() => this.emptyCanvas_); // tile non trovata (404) → canvas vuoto silenzioso
        this.tileCache.set(cacheKey, promise);
        if (this.tileCache.getCount() > 2 * this.tileCache.highWaterMark) {
          while (this.tileCache.canExpireCache()) {
            this.tileCache.pop();
          }
        }
      }
      return promise;
    } catch (e) {
      console.trace(e);
      // FIXME: open PR on Cesium to fix incorrect typing
      // @ts-ignore
      this.errorEvent.raiseEvent('could not render pbf to tile', e);
    }
  }
  rasterizeFeatures(features, styleFunction, resolution) {
    const canvas = document.createElement('canvas');
    const vectorContext = (0,ol_render_js__WEBPACK_IMPORTED_MODULE_3__.toContext)(canvas.getContext('2d'), {
      size: [this.tileWidth, this.tileHeight]
    });
    features.forEach(f => {
      const styles = styleFunction(f, resolution);
      const geomForDraw = f.getGeometry ? f.getGeometry() : f;
      if (styles) {
        if (Array.isArray(styles)) {
          styles.forEach(style => {
            vectorContext.setStyle(style);
            vectorContext.drawGeometry(geomForDraw);
          });
        } else {
          vectorContext.setStyle(styles);
          vectorContext.drawGeometry(geomForDraw);
        }
      }
    });
    return canvas;
  }
}

/***/ }),

/***/ "./src/olcs/OLCesium.ts":
/*!******************************!*\
  !*** ./src/olcs/OLCesium.ts ***!
  \******************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ OLCesium)
/* harmony export */ });
/* harmony import */ var ol_geom_Point_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ol/geom/Point.js */ "ol/geom/Point.js");
/* harmony import */ var ol_geom_Point_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(ol_geom_Point_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _util__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./util */ "./src/olcs/util.ts");
/* harmony import */ var _core__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./core */ "./src/olcs/core.ts");
/* harmony import */ var ol_proj_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ol/proj.js */ "ol/proj.js");
/* harmony import */ var ol_proj_js__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(ol_proj_js__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var _AutoRenderLoop__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./AutoRenderLoop */ "./src/olcs/AutoRenderLoop.ts");
/* harmony import */ var _Camera__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./Camera */ "./src/olcs/Camera.ts");
/* harmony import */ var _RasterSynchronizer__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./RasterSynchronizer */ "./src/olcs/RasterSynchronizer.ts");
/* harmony import */ var _VectorSynchronizer__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./VectorSynchronizer */ "./src/olcs/VectorSynchronizer.ts");
/* harmony import */ var _OverlaySynchronizer__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./OverlaySynchronizer */ "./src/olcs/OverlaySynchronizer.ts");









/**
 * Moved from Cesium
 * The state of a BoundingSphere computation being performed by a {@link Visualizer}.
 */
const BoundingSphereState = {
  /**
   * The BoundingSphere has been computed.
   */
  DONE: 0,
  /**
   * The BoundingSphere is still being computed.
   */
  PENDING: 1,
  /**
   * The BoundingSphere does not exist.
   */
  FAILED: 2
};

// FIXME: remove this when all the synchronizers are migrated to typescript.

/**
 * @typedef {Object} OLCesiumOptions
 * @property {import('ol/Map.js').default} map The OpenLayers map we want to show on a Cesium scene.
 * @property {Element|string} [target] Target element for the Cesium scene.
 * @property {function(!import('ol/Map.js').default, !Cesium.Scene, !Cesium.DataSourceCollection): Array<import('olcs/AbstractSynchronizer.js').default>}
 *      [createSynchronizers] Callback function which will be called by the {@link olcs.OLCesium}
 *      constructor to create custom synchronizers. Receives an `ol.Map` and a `Cesium.Scene` as arguments,
 *      and needs to return an array of {@link import('olcs/AbstractSynchronizer.js').default}.
 * @property {function(): Cesium.JulianDate} [time] Control the current time used by Cesium.
 * @property {boolean} [stopOpenLayersEventsPropagation] Prevent propagation of mouse/touch events to
 *      OpenLayers when Cesium is active.
 * @property {Cesium.SceneOptions} [sceneOptions] Allows the passing of property value to the
 *      `Cesium.Scene`.
 */
class OLCesium {
  constructor(options) {
    this.autoRenderLoop_ = null;
    this.resolutionScale_ = 1.0;
    this.canvasClientWidth_ = 0.0;
    this.canvasClientHeight_ = 0.0;
    this.resolutionScaleChanged_ = true;
    this.enabled_ = false;
    this.pausedInteractions_ = [];
    this.hiddenRootGroup_ = null;
    /** Time of the last rendered frame, as returned by `performance.now()`. */
    this.lastFrameTime_ = 0;
    /** Target frame rate for the render loop.  */
    this.targetFrameRate_ = Number.POSITIVE_INFINITY;
    /** If the Cesium render loop is being blocked. */
    this.blockCesiumRendering_ = false;
    /** If the warmup routine is active. */
    this.warmingUp_ = false;
    this.trackedFeature_ = null;
    this.trackedEntity_ = null;
    this.entityView_ = null;
    this.needTrackedEntityUpdate_ = false;
    this.boundingSphereScratch_ = new Cesium.BoundingSphere();
    this.map_ = options.map;
    this.time_ = options.time || function () {
      return Cesium.JulianDate.now();
    };

    /**
     * No change of the view projection.
     */
    this.to4326Transform_ = (0,ol_proj_js__WEBPACK_IMPORTED_MODULE_3__.getTransform)(this.map_.getView().getProjection(), 'EPSG:4326');
    const fillArea = 'position:absolute;top:0;left:0;width:100%;height:100%;touch-action:none;';
    this.container_ = document.createElement('DIV');
    const containerAttribute = document.createAttribute('style');
    containerAttribute.value = `${fillArea}visibility:hidden;`;
    this.container_.setAttributeNode(containerAttribute);
    let targetElement = options.target || this.map_.getViewport();
    if (typeof targetElement === 'string') {
      targetElement = document.getElementById(targetElement);
    }
    targetElement.appendChild(this.container_);

    /**
     * Whether the Cesium container is placed over the ol map.
     * a target => side by side mode
     * no target => over map mode
     */
    this.isOverMap_ = !options.target;
    if (this.isOverMap_ && options.stopOpenLayersEventsPropagation) {
      const overlayEvents = ['click', 'dblclick', 'mousedown', 'touchstart', 'pointerdown', 'mousewheel', 'wheel'];
      for (let i = 0, ii = overlayEvents.length; i < ii; ++i) {
        this.container_.addEventListener(overlayEvents[i], evt => evt.stopPropagation());
      }
    }
    this.canvas_ = document.createElement('canvas');
    const canvasAttribute = document.createAttribute('style');
    canvasAttribute.value = fillArea;
    this.canvas_.setAttributeNode(canvasAttribute);
    if ((0,_util__WEBPACK_IMPORTED_MODULE_1__.supportsImageRenderingPixelated)()) {
      // non standard CSS4
      this.canvas_.style['imageRendering'] = (0,_util__WEBPACK_IMPORTED_MODULE_1__.imageRenderingValue)();
    }
    this.canvas_.oncontextmenu = function () {
      return false;
    };
    this.canvas_.onselectstart = function () {
      return false;
    };
    this.container_.appendChild(this.canvas_);
    const sceneOptions = options.sceneOptions !== undefined ? {
      ...options.sceneOptions,
      canvas: this.canvas_,
      scene3DOnly: true
    } : {
      canvas: this.canvas_,
      scene3DOnly: true
    };
    this.scene_ = new Cesium.Scene(sceneOptions);
    const sscc = this.scene_.screenSpaceCameraController;
    if (!Array.isArray(sscc.tiltEventTypes)) {
      console.log('sscc is not an array');
    } else {
      sscc.tiltEventTypes.push({
        'eventType': Cesium.CameraEventType.LEFT_DRAG,
        'modifier': Cesium.KeyboardEventModifier.SHIFT
      });
      sscc.tiltEventTypes.push({
        'eventType': Cesium.CameraEventType.LEFT_DRAG,
        'modifier': Cesium.KeyboardEventModifier.ALT
      });
    }
    sscc.enableLook = false;
    this.scene_.camera.constrainedAxis = Cesium.Cartesian3.UNIT_Z;
    this.camera_ = new _Camera__WEBPACK_IMPORTED_MODULE_5__["default"](this.scene_, this.map_);
    this.globe_ = new Cesium.Globe(Cesium.Ellipsoid.WGS84);
    this.globe_.baseColor = Cesium.Color.WHITE;
    this.scene_.globe = this.globe_;
    this.scene_.skyAtmosphere = new Cesium.SkyAtmosphere();

    // The first layer of Cesium is special; using a 1x1 transparent image to workaround it.
    // See https://github.com/AnalyticalGraphicsInc/cesium/issues/1323 for details.
    const firstImageryProvider = new Cesium.SingleTileImageryProvider({
      tileHeight: 1,
      tileWidth: 1,
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      rectangle: Cesium.Rectangle.fromDegrees(0, 0, 1, 1) // the Rectangle dimensions are arbitrary
    });
    this.globe_.imageryLayers.addImageryProvider(firstImageryProvider, 0);
    this.dataSourceCollection_ = new Cesium.DataSourceCollection();
    this.dataSourceDisplay_ = new Cesium.DataSourceDisplay({
      scene: this.scene_,
      dataSourceCollection: this.dataSourceCollection_
    });
    this.synchronizers_ = options.createSynchronizers ? options.createSynchronizers(this.map_, this.scene_, this.dataSourceCollection_) : [new _RasterSynchronizer__WEBPACK_IMPORTED_MODULE_6__["default"](this.map_, this.scene_), new _VectorSynchronizer__WEBPACK_IMPORTED_MODULE_7__["default"](this.map_, this.scene_), new _OverlaySynchronizer__WEBPACK_IMPORTED_MODULE_8__["default"](this.map_, this.scene_)];

    // Assures correct canvas size after initialisation
    this.handleResize_();
    for (let i = this.synchronizers_.length - 1; i >= 0; --i) {
      this.synchronizers_[i].synchronize();
    }
    const eventHelper = new Cesium.EventHelper();
    eventHelper.add(this.scene_.postRender, OLCesium.prototype.updateTrackedEntity_, this);
  }

  /**
   * Destroys the Cesium resources held by this object.
   */
  destroy() {
    cancelAnimationFrame(this.renderId_);
    this.renderId_ = undefined;
    this.synchronizers_.forEach(synchronizer => synchronizer.destroyAll());
    this.camera_.destroy();
    this.scene_.destroy();
    // @ts-ignore TS2341
    this.scene_._postRender = null;
    this.container_.remove();
  }

  /**
   * Render the Cesium scene.
   */
  render_() {
    // if a call to `requestAnimationFrame` is pending, cancel it
    if (this.renderId_ !== undefined) {
      cancelAnimationFrame(this.renderId_);
      this.renderId_ = undefined;
    }

    // only render if Cesium is enabled/warming and rendering hasn't been blocked
    if ((this.enabled_ || this.warmingUp_) && !this.blockCesiumRendering_) {
      this.renderId_ = requestAnimationFrame(this.onAnimationFrame_.bind(this));
    }
  }

  /**
   * Callback for `requestAnimationFrame`.
   * @param {number} frameTime The frame time, from `performance.now()`.
   */
  onAnimationFrame_(frameTime) {
    this.renderId_ = undefined;

    // check if a frame was rendered within the target frame rate
    const interval = 1000.0 / this.targetFrameRate_;
    const delta = frameTime - this.lastFrameTime_;
    if (delta < interval) {
      // too soon, don't render yet
      this.render_();
      return;
    }

    // time to render a frame, save the time
    this.lastFrameTime_ = frameTime;
    const julianDate = this.time_();
    // initializeFrame private property
    // @ts-ignore TS2341
    this.scene_.initializeFrame();
    this.handleResize_();
    this.dataSourceDisplay_.update(julianDate);

    // Update tracked entity
    if (this.entityView_) {
      const trackedEntity = this.trackedEntity_;
      // getBoundingSphere private property
      // @ts-ignore TS2341
      const trackedState = this.dataSourceDisplay_.getBoundingSphere(trackedEntity, false, this.boundingSphereScratch_);
      if (trackedState === BoundingSphereState.DONE) {
        this.boundingSphereScratch_.radius = 1; // a radius of 1 is enough for tracking points
        this.entityView_.update(julianDate, this.boundingSphereScratch_);
      }
    }
    this.scene_.render(julianDate);
    this.camera_.checkCameraChange();

    // request the next render call after this one completes to ensure the browser doesn't get backed up
    this.render_();
  }
  updateTrackedEntity_() {
    if (!this.needTrackedEntityUpdate_) {
      return;
    }
    const trackedEntity = this.trackedEntity_;
    const scene = this.scene_;

    // getBoundingSphere private property
    // @ts-ignore TS2341
    const state = this.dataSourceDisplay_.getBoundingSphere(trackedEntity, false, this.boundingSphereScratch_);
    if (state === BoundingSphereState.PENDING) {
      return;
    }
    scene.screenSpaceCameraController.enableTilt = false;
    const bs = state !== BoundingSphereState.FAILED ? this.boundingSphereScratch_ : undefined;
    if (bs) {
      bs.radius = 1;
    }
    this.entityView_ = new Cesium.EntityView(trackedEntity, scene, scene.mapProjection.ellipsoid);
    this.entityView_.update(this.time_(), bs);
    this.needTrackedEntityUpdate_ = false;
  }
  handleResize_() {
    let width = this.canvas_.clientWidth;
    let height = this.canvas_.clientHeight;
    if (width === 0 || height === 0) {
      // The canvas DOM element is not ready yet.
      return;
    }
    if (width === this.canvasClientWidth_ && height === this.canvasClientHeight_ && !this.resolutionScaleChanged_) {
      return;
    }
    let resolutionScale = this.resolutionScale_;
    if (!(0,_util__WEBPACK_IMPORTED_MODULE_1__.supportsImageRenderingPixelated)()) {
      resolutionScale *= window.devicePixelRatio || 1.0;
    }
    this.resolutionScaleChanged_ = false;
    this.canvasClientWidth_ = width;
    this.canvasClientHeight_ = height;
    width *= resolutionScale;
    height *= resolutionScale;
    this.canvas_.width = width;
    this.canvas_.height = height;
    this.scene_.camera.frustum.aspectRatio = width / height;
  }
  getCamera() {
    return this.camera_;
  }
  getOlMap() {
    return this.map_;
  }
  getOlView() {
    const view = this.map_.getView();
    console.assert(view);
    return view;
  }
  getCesiumScene() {
    return this.scene_;
  }
  getDataSources() {
    return this.dataSourceCollection_;
  }
  getDataSourceDisplay() {
    return this.dataSourceDisplay_;
  }
  getEnabled() {
    return this.enabled_;
  }

  /**
   * Enables/disables the Cesium.
   * This modifies the visibility style of the container element.
   */
  setEnabled(enable) {
    if (this.enabled_ === enable) {
      return;
    }
    this.enabled_ = enable;

    // some Cesium operations are operating with canvas.clientWidth,
    // so we can't remove it from DOM or even make display:none;
    this.container_.style.visibility = this.enabled_ ? 'visible' : 'hidden';
    let interactions;
    if (this.enabled_) {
      this.throwOnUnitializedMap_();
      if (this.isOverMap_) {
        interactions = this.map_.getInteractions();
        interactions.forEach((el, i, arr) => {
          this.pausedInteractions_.push(el);
        });
        interactions.clear();
        this.map_.addInteraction = interaction => this.pausedInteractions_.push(interaction);
        this.map_.removeInteraction = interaction => {
          let interactionRemoved = false;
          this.pausedInteractions_ = this.pausedInteractions_.filter(i => {
            const removed = i !== interaction;
            if (!interactionRemoved) {
              interactionRemoved = removed;
            }
            return removed;
          });
          return interactionRemoved ? interaction : undefined;
        };
        const rootGroup = this.map_.getLayerGroup();
        if (rootGroup.getVisible()) {
          this.hiddenRootGroup_ = rootGroup;
          this.hiddenRootGroup_.setVisible(false);
        }
        this.map_.getOverlayContainer().classList.add('olcs-hideoverlay');
      }
      this.camera_.readFromView();
      this.render_();
    } else {
      if (this.isOverMap_) {
        interactions = this.map_.getInteractions();
        this.pausedInteractions_.forEach(interaction => {
          interactions.push(interaction);
        });
        this.pausedInteractions_.length = 0;
        this.map_.addInteraction = interaction => this.map_.getInteractions().push(interaction);
        this.map_.removeInteraction = interaction => this.map_.getInteractions().remove(interaction);
        this.map_.getOverlayContainer().classList.remove('olcs-hideoverlay');
        if (this.hiddenRootGroup_) {
          this.hiddenRootGroup_.setVisible(true);
          this.hiddenRootGroup_ = null;
        }
      }
      this.camera_.updateView();
    }
  }

  /**
   * Preload Cesium so that it is ready when transitioning from 2D to 3D.
   * @param {number} height Target height of the camera
   * @param {number} timeout Milliseconds after which the warming will stop
  */
  warmUp(height, timeout) {
    if (this.enabled_) {
      // already enabled
      return;
    }
    this.throwOnUnitializedMap_();
    this.camera_.readFromView();
    const ellipsoid = this.globe_.ellipsoid;
    const csCamera = this.scene_.camera;
    const position = ellipsoid.cartesianToCartographic(csCamera.position);
    if (position.height < height) {
      position.height = height;
      csCamera.position = ellipsoid.cartographicToCartesian(position);
    }
    this.warmingUp_ = true;
    this.render_();
    setTimeout(() => {
      this.warmingUp_ = false;
    }, timeout);
  }

  /**
   * Block Cesium rendering to save resources.
   * @param {boolean} block True to block.
  */
  setBlockCesiumRendering(block) {
    if (this.blockCesiumRendering_ !== block) {
      this.blockCesiumRendering_ = block;

      // reset the render loop
      this.render_();
    }
  }

  /**
   * Render the globe only when necessary in order to save resources.
   * Experimental.
   */
  enableAutoRenderLoop() {
    if (!this.autoRenderLoop_) {
      this.autoRenderLoop_ = new _AutoRenderLoop__WEBPACK_IMPORTED_MODULE_4__["default"](this);
    }
  }

  /**
   * Get the autorender loop.
  */
  getAutoRenderLoop() {
    return this.autoRenderLoop_;
  }

  /**
   * The 3D Cesium globe is rendered in a canvas with two different dimensions:
   * clientWidth and clientHeight which are the dimension on the screen and
   * width and height which are the dimensions of the drawing buffer.
   *
   * By using a resolution scale lower than 1.0, it is possible to render the
   * globe in a buffer smaller than the canvas client dimensions and improve
   * performance, at the cost of quality.
   *
   * Pixel ratio should also be taken into account; by default, a device with
   * pixel ratio of 2.0 will have a buffer surface 4 times bigger than the client
   * surface.
   */
  setResolutionScale(value) {
    value = Math.max(0, value);
    if (value !== this.resolutionScale_) {
      this.resolutionScale_ = Math.max(0, value);
      this.resolutionScaleChanged_ = true;
      if (this.autoRenderLoop_) {
        this.autoRenderLoop_.restartRenderLoop();
      }
    }
  }

  /**
   * Set the target frame rate for the renderer. Set to `Number.POSITIVE_INFINITY`
   * to render as quickly as possible.
   * @param {number} value The frame rate, in frames per second.
   */
  setTargetFrameRate(value) {
    if (this.targetFrameRate_ !== value) {
      this.targetFrameRate_ = value;

      // reset the render loop
      this.render_();
    }
  }

  /**
   * Check if OpenLayers map is not properly initialized.
   */
  throwOnUnitializedMap_() {
    const map = this.map_;
    const view = map.getView();
    const center = view.getCenter();
    if (!view.isDef() || isNaN(center[0]) || isNaN(center[1])) {
      throw new Error(`The OpenLayers map is not properly initialized: ${center} / ${view.getResolution()}`);
    }
  }
  get trackedFeature() {
    return this.trackedFeature_;
  }
  set trackedFeature(feature) {
    if (this.trackedFeature_ !== feature) {
      const scene = this.scene_;

      //Stop tracking
      if (!feature || !feature.getGeometry()) {
        this.needTrackedEntityUpdate_ = false;
        scene.screenSpaceCameraController.enableTilt = true;
        if (this.trackedEntity_) {
          this.dataSourceDisplay_.defaultDataSource.entities.remove(this.trackedEntity_);
        }
        this.trackedEntity_ = null;
        this.trackedFeature_ = null;
        this.entityView_ = null;
        scene.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        return;
      }
      this.trackedFeature_ = feature;

      //We can't start tracking immediately, so we set a flag and start tracking
      //when the bounding sphere is ready (most likely next frame).
      this.needTrackedEntityUpdate_ = true;
      const to4326Transform = this.to4326Transform_;
      const toCesiumPosition = function () {
        const geometry = feature.getGeometry();
        console.assert(geometry instanceof (ol_geom_Point_js__WEBPACK_IMPORTED_MODULE_0___default()));
        const coo = geometry instanceof (ol_geom_Point_js__WEBPACK_IMPORTED_MODULE_0___default()) ? geometry.getCoordinates() : [];
        const coo4326 = to4326Transform(coo, undefined, coo.length);
        return (0,_core__WEBPACK_IMPORTED_MODULE_2__.ol4326CoordinateToCesiumCartesian)(coo4326);
      };

      // Create an invisible point entity for tracking.
      // It is independent of the primitive/geometry created by the vector synchronizer.
      const options = {
        // @ts-ignore according to Cesium types, not possible to pass CallbackProperty
        position: new Cesium.CallbackProperty((time, result) => toCesiumPosition(), false),
        point: {
          pixelSize: 1,
          color: Cesium.Color.TRANSPARENT
        }
      };
      this.trackedEntity_ = this.dataSourceDisplay_.defaultDataSource.entities.add(options);
    }
  }
}

/***/ }),

/***/ "./src/olcs/OverlaySynchronizer.ts":
/*!*****************************************!*\
  !*** ./src/olcs/OverlaySynchronizer.ts ***!
  \*****************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ OverlaySynchronizer)
/* harmony export */ });
/* harmony import */ var _SynchronizedOverlay__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./SynchronizedOverlay */ "./src/olcs/SynchronizedOverlay.ts");
/* harmony import */ var _util__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./util */ "./src/olcs/util.ts");


class OverlaySynchronizer {
  /**
  * @param map
  * @param scene
  * @constructor
  * @api
  */
  constructor(map, scene) {
    this.overlayMap_ = new Map();
    this.overlayEvents = ['click', 'dblclick', 'mousedown', 'touchstart', 'pointerdown', 'mousewheel', 'wheel'];
    this.map = map;
    this.scene = scene;
    this.map = map;
    this.overlayCollection_ = this.map.getOverlays();
    this.scene = scene;
    this.overlayContainerStopEvent_ = document.createElement('div');
    this.overlayContainerStopEvent_.className = 'ol-overlaycontainer-stopevent';
    this.overlayEvents.forEach(name => {
      this.overlayContainerStopEvent_.addEventListener(name, evt => evt.stopPropagation());
    });
    this.scene.canvas.parentElement.appendChild(this.overlayContainerStopEvent_);
    this.overlayContainer_ = document.createElement('div');
    this.overlayContainer_.className = 'ol-overlaycontainer';
    this.scene.canvas.parentElement.appendChild(this.overlayContainer_);
  }

  /**
  * Get the element that serves as a container for overlays that don't allow
  * event propagation. Elements added to this container won't let mousedown and
  * touchstart events through to the map, so clicks and gestures on an overlay
  * don't trigger any {@link ol.MapBrowserEvent}.
  * @return The map's overlay container that stops events.
  */
  getOverlayContainerStopEvent() {
    return this.overlayContainerStopEvent_;
  }

  /**
  * Get the element that serves as a container for overlays.
  * @return The map's overlay container.
  */
  getOverlayContainer() {
    return this.overlayContainer_;
  }

  /**
  * Destroy all and perform complete synchronization of the overlays.
  * @api
  */
  synchronize() {
    this.destroyAll();
    this.overlayCollection_.forEach(overlay => {
      this.addOverlay(overlay);
    });
    this.overlayCollection_.on('add', evt => this.addOverlay(evt.element));
    this.overlayCollection_.on('remove', evt => this.removeOverlay(evt.element));
  }

  /**
  * @api
  */
  addOverlay(overlay) {
    if (!overlay) {
      return;
    }
    const cesiumOverlay = new _SynchronizedOverlay__WEBPACK_IMPORTED_MODULE_0__["default"]({
      scene: this.scene,
      synchronizer: this,
      parent: overlay
    });
    this.overlayMap_.set((0,_util__WEBPACK_IMPORTED_MODULE_1__.getUid)(overlay), cesiumOverlay);
  }

  /**
  * Removes an overlay from the scene
  * @api
  */
  removeOverlay(overlay) {
    const overlayId = (0,_util__WEBPACK_IMPORTED_MODULE_1__.getUid)(overlay);
    const csOverlay = this.overlayMap_.get(overlayId);
    if (csOverlay) {
      csOverlay.destroy();
      this.overlayMap_.delete(overlayId);
    }
  }

  /**
  * Destroys all the created Cesium objects.
  */
  destroyAll() {
    this.overlayMap_.forEach(overlay => {
      overlay.destroy();
    });
    this.overlayMap_.clear();
  }
}

/***/ }),

/***/ "./src/olcs/RasterSynchronizer.ts":
/*!****************************************!*\
  !*** ./src/olcs/RasterSynchronizer.ts ***!
  \****************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ RasterSynchronizer)
/* harmony export */ });
/* harmony import */ var _util__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./util */ "./src/olcs/util.ts");
/* harmony import */ var _AbstractSynchronizer__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./AbstractSynchronizer */ "./src/olcs/AbstractSynchronizer.ts");
/* harmony import */ var _core__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./core */ "./src/olcs/core.ts");
/* harmony import */ var ol_layer_BaseVector_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ol/layer/BaseVector.js */ "ol/layer/BaseVector.js");
/* harmony import */ var ol_layer_BaseVector_js__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(ol_layer_BaseVector_js__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var ol_layer_Group_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ol/layer/Group.js */ "ol/layer/Group.js");
/* harmony import */ var ol_layer_Group_js__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(ol_layer_Group_js__WEBPACK_IMPORTED_MODULE_4__);





class RasterSynchronizer extends _AbstractSynchronizer__WEBPACK_IMPORTED_MODULE_1__["default"] {
  /**
   * This object takes care of one-directional synchronization of
   * Openlayers raster layers to the given Cesium globe.
   */
  constructor(map, scene) {
    super(map, scene);
    this.cesiumLayers_ = scene.imageryLayers;
    this.ourLayers_ = new Cesium.ImageryLayerCollection();
  }
  addCesiumObject(object) {
    this.cesiumLayers_.add(object);
    this.ourLayers_.add(object);
  }
  destroyCesiumObject(object) {
    object.destroy();
  }
  removeSingleCesiumObject(object, destroy) {
    this.cesiumLayers_.remove(object, destroy);
    this.ourLayers_.remove(object, false);
  }
  removeAllCesiumObjects(destroy) {
    for (let i = 0; i < this.ourLayers_.length; ++i) {
      this.cesiumLayers_.remove(this.ourLayers_.get(i), destroy);
    }
    this.ourLayers_.removeAll(false);
  }

  /**
   * Creates an array of Cesium.ImageryLayer.
   * May be overriden by child classes to implement custom behavior.
   * The default implementation handles tiled imageries in EPSG:4326 or
   * EPSG:3859.
   */
  convertLayerToCesiumImageries(olLayer, viewProj) {
    const result = (0,_core__WEBPACK_IMPORTED_MODULE_2__.tileLayerToImageryLayer)(this.map, olLayer, viewProj);
    return result ? [result] : null;
  }
  createSingleLayerCounterparts(olLayerWithParents) {
    const olLayer = olLayerWithParents.layer;
    const uid = (0,_util__WEBPACK_IMPORTED_MODULE_0__.getUid)(olLayer).toString();
    const viewProj = this.view.getProjection();
    console.assert(viewProj);
    const cesiumObjects = this.convertLayerToCesiumImageries(olLayer, viewProj);
    if (cesiumObjects) {
      const listenKeyArray = [];
      [olLayerWithParents.layer].concat(olLayerWithParents.parents).forEach(olLayerItem => {
        listenKeyArray.push(olLayerItem.on(['change:opacity', 'change:visible'], () => {
          // the compiler does not seem to be able to infer this
          console.assert(cesiumObjects);
          for (let i = 0; i < cesiumObjects.length; ++i) {
            (0,_core__WEBPACK_IMPORTED_MODULE_2__.updateCesiumLayerProperties)(olLayerWithParents, cesiumObjects[i]);
          }
        }));
      });
      if (olLayer instanceof (ol_layer_BaseVector_js__WEBPACK_IMPORTED_MODULE_3___default())) {
        let previousStyleFunction = olLayer.getStyleFunction();
        // there is no convenient way to detect a style function change in OL
        listenKeyArray.push(olLayer.on('change', () => {
          const currentStyleFunction = olLayer.getStyleFunction();
          if (previousStyleFunction === currentStyleFunction) {
            return;
          }
          previousStyleFunction = currentStyleFunction;
          for (let i = 0; i < cesiumObjects.length; ++i) {
            const csObj = cesiumObjects[i];
            // clear cache and set new style
            // @ts-ignore TS2341
            if (csObj._imageryCache) {
              // @ts-ignore TS2341
              csObj._imageryCache = {};
            }
            const ip = csObj.imageryProvider;
            if (ip) {
              var _ip$tileCache;
              // @ts-ignore TS2341
              (_ip$tileCache = ip.tileCache) == null || _ip$tileCache.clear();
              // @ts-ignore TS2341
              ip.styleFunction_ = currentStyleFunction;
            }
          }
          this.scene.requestRender();
        }));
      }
      for (let i = 0; i < cesiumObjects.length; ++i) {
        (0,_core__WEBPACK_IMPORTED_MODULE_2__.updateCesiumLayerProperties)(olLayerWithParents, cesiumObjects[i]);
      }

      // there is no way to modify Cesium layer extent,
      // we have to recreate when OpenLayers layer extent changes:
      listenKeyArray.push(olLayer.on('change:extent', e => {
        for (let i = 0; i < cesiumObjects.length; ++i) {
          this.cesiumLayers_.remove(cesiumObjects[i], true); // destroy
          this.ourLayers_.remove(cesiumObjects[i], false);
        }
        delete this.layerMap[(0,_util__WEBPACK_IMPORTED_MODULE_0__.getUid)(olLayer)]; // invalidate the map entry
        this.synchronize();
      }));
      listenKeyArray.push(olLayer.on('change', e => {
        // when the source changes, re-add the layer to force update
        for (let i = 0; i < cesiumObjects.length; ++i) {
          const position = this.cesiumLayers_.indexOf(cesiumObjects[i]);
          if (position >= 0) {
            this.cesiumLayers_.remove(cesiumObjects[i], false);
            this.cesiumLayers_.add(cesiumObjects[i], position);
          }
        }
      }));
      this.olLayerListenKeys[uid].push(...listenKeyArray);
    }
    return Array.isArray(cesiumObjects) ? cesiumObjects : null;
  }

  /**
   * Order counterparts using the same algorithm as the Openlayers renderer:
   * z-index then original sequence order.
   * @override
   * @protected
   */
  orderLayers() {
    const layers = [];
    const zIndices = {};
    const queue = [this.mapLayerGroup];
    while (queue.length > 0) {
      const olLayer = queue.splice(0, 1)[0];
      layers.push(olLayer);
      zIndices[(0,_util__WEBPACK_IMPORTED_MODULE_0__.getUid)(olLayer)] = olLayer.getZIndex() || 0;
      if (olLayer instanceof (ol_layer_Group_js__WEBPACK_IMPORTED_MODULE_4___default())) {
        const sublayers = olLayer.getLayers();
        if (sublayers) {
          // Prepend queue with sublayers in order
          queue.unshift(...sublayers.getArray());
        }
      }
    }

    // We assume sort is stable (which has been in the spec since a long time already).
    // See https://caniuse.com/mdn-javascript_builtins_array_sort_stable
    layers.sort((layer1, layer2) => zIndices[(0,_util__WEBPACK_IMPORTED_MODULE_0__.getUid)(layer1)] - zIndices[(0,_util__WEBPACK_IMPORTED_MODULE_0__.getUid)(layer2)]);
    layers.forEach(olLayer => {
      const olLayerId = (0,_util__WEBPACK_IMPORTED_MODULE_0__.getUid)(olLayer).toString();
      const cesiumObjects = this.layerMap[olLayerId];
      if (cesiumObjects) {
        cesiumObjects.forEach(cesiumObject => {
          this.raiseToTop(cesiumObject);
        });
      }
    });
  }
  raiseToTop(counterpart) {
    this.cesiumLayers_.raiseToTop(counterpart);
  }
}

/***/ }),

/***/ "./src/olcs/SynchronizedOverlay.ts":
/*!*****************************************!*\
  !*** ./src/olcs/SynchronizedOverlay.ts ***!
  \*****************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ SynchronizedOverlay)
/* harmony export */ });
/* harmony import */ var ol_Overlay_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ol/Overlay.js */ "ol/Overlay.js");
/* harmony import */ var ol_Overlay_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(ol_Overlay_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var ol_proj_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ol/proj.js */ "ol/proj.js");
/* harmony import */ var ol_proj_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(ol_proj_js__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var ol_Observable_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ol/Observable.js */ "ol/Observable.js");
/* harmony import */ var ol_Observable_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(ol_Observable_js__WEBPACK_IMPORTED_MODULE_2__);



/**
 * @param node The node to remove.
 * @return The node that was removed or null.
 */
function removeNode(node) {
  return node && node.parentNode ? node.parentNode.removeChild(node) : null;
}

/**
 * @param {Node} node The node to remove the children from.
 */
function removeChildren(node) {
  while (node.lastChild) {
    node.removeChild(node.lastChild);
  }
}
function cloneNode(node, parent) {
  const clone = node.cloneNode();
  if (node.nodeName === 'CANVAS') {
    const ctx = clone.getContext('2d');
    ctx.drawImage(node, 0, 0);
  }
  if (parent) {
    parent.appendChild(clone);
  }
  if (node.nodeType !== Node.TEXT_NODE) {
    clone.addEventListener('click', event => {
      node.dispatchEvent(new MouseEvent('click', event));
      event.stopPropagation();
    });
  }
  const nodes = node.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i]) {
      continue;
    }
    cloneNode(nodes[i], clone);
  }
  return clone;
}
class SynchronizedOverlay extends (ol_Overlay_js__WEBPACK_IMPORTED_MODULE_0___default()) {
  /**
   * @param options SynchronizedOverlay Options.
   * @api
   */
  constructor(options) {
    const parent = options.parent;
    super(parent.getOptions());
    this.scenePostRenderListenerRemover_ = null;
    this.attributeObserver_ = [];
    this.scene_ = options.scene;
    this.synchronizer_ = options.synchronizer;
    this.parent_ = parent;
    this.positionWGS84_ = undefined;
    this.observer_ = new MutationObserver(this.handleElementChanged.bind(this));
    this.attributeObserver_ = [];
    this.listenerKeys_ = [];

    // synchronize our Overlay with the parent Overlay
    const setPropertyFromEvent = event => this.setPropertyFromEvent_(event);
    this.listenerKeys_.push(this.parent_.on('change:element', setPropertyFromEvent));
    this.listenerKeys_.push(this.parent_.on('change:offset', setPropertyFromEvent));
    this.listenerKeys_.push(this.parent_.on('change:position', setPropertyFromEvent));
    this.listenerKeys_.push(this.parent_.on('change:positioning', setPropertyFromEvent));
    this.setProperties(this.parent_.getProperties());
    this.handleMapChanged();
    this.handleElementChanged();
  }

  /**
   * @param target
   */
  observeTarget_(target) {
    if (!this.observer_) {
      // not ready, skip the event (this occurs on construction)
      return;
    }
    this.observer_.disconnect();
    this.observer_.observe(target, {
      attributes: false,
      childList: true,
      characterData: true,
      subtree: true
    });
    this.attributeObserver_.forEach(observer => {
      observer.disconnect();
    });
    this.attributeObserver_.length = 0;
    for (let i = 0; i < target.childNodes.length; i++) {
      const node = target.childNodes[i];
      if (node.nodeType === 1) {
        const observer = new MutationObserver(this.handleElementChanged.bind(this));
        observer.observe(node, {
          attributes: true,
          subtree: true
        });
        this.attributeObserver_.push(observer);
      }
    }
  }

  /**
   *
   * @param event
   */
  setPropertyFromEvent_(event) {
    if (event.target && event.key) {
      this.set(event.key, event.target.get(event.key));
    }
  }

  /**
   * Get the scene associated with this overlay.
   * @see ol.Overlay.prototype.getMap
   * @return The scene that the overlay is part of.
   * @api
   */
  getScene() {
    return this.scene_;
  }

  /**
   * @override
   */
  handleMapChanged() {
    if (this.scenePostRenderListenerRemover_) {
      this.scenePostRenderListenerRemover_();
      removeNode(this.element);
    }
    this.scenePostRenderListenerRemover_ = null;
    const scene = this.getScene();
    if (scene) {
      this.scenePostRenderListenerRemover_ = scene.postRender.addEventListener(this.updatePixelPosition.bind(this));
      this.updatePixelPosition();
      const container = this.stopEvent ? this.synchronizer_.getOverlayContainerStopEvent() : this.synchronizer_.getOverlayContainer();
      if (this.insertFirst) {
        container.insertBefore(this.element, container.childNodes[0] || null);
      } else {
        container.appendChild(this.element);
      }
    }
  }

  /**
   * @override
   */
  handlePositionChanged() {
    // transform position to WGS84
    const position = this.getPosition();
    if (position) {
      const sourceProjection = this.parent_.getMap().getView().getProjection();
      this.positionWGS84_ = (0,ol_proj_js__WEBPACK_IMPORTED_MODULE_1__.transform)(position, sourceProjection, 'EPSG:4326');
    } else {
      this.positionWGS84_ = undefined;
    }
    this.updatePixelPosition();
  }

  /**
   * @override
   */
  handleElementChanged() {
    removeChildren(this.element);
    const element = this.getElement();
    if (element) {
      if (element.parentNode && element.parentNode.childNodes) {
        for (const node of Array.from(element.parentNode.childNodes)) {
          const clonedNode = cloneNode(node, null);
          this.element.appendChild(clonedNode);
        }
      }
    }
    if (element.parentNode) {
      // set new Observer
      this.observeTarget_(element.parentNode);
    }
  }

  /**
   * @override
   */
  updatePixelPosition() {
    const position = this.positionWGS84_;
    if (!this.scene_ || !position) {
      this.setVisible(false);
      return;
    }
    let height = 0;
    if (position.length === 2) {
      const globeHeight = this.scene_.globe.getHeight(Cesium.Cartographic.fromDegrees(position[0], position[1]));
      if (globeHeight && this.scene_.globe.tilesLoaded) {
        position[2] = globeHeight;
      }
      if (globeHeight) {
        height = globeHeight;
      }
    } else {
      height = position[2];
    }
    const cartesian = Cesium.Cartesian3.fromDegrees(position[0], position[1], height);
    const camera = this.scene_.camera;
    const ellipsoidBoundingSphere = new Cesium.BoundingSphere(new Cesium.Cartesian3(), 6356752);
    const occluder = new Cesium.Occluder(ellipsoidBoundingSphere, camera.position);
    // check if overlay position is behind the horizon
    if (!occluder.isPointVisible(cartesian)) {
      this.setVisible(false);
      return;
    }
    const cullingVolume = camera.frustum.computeCullingVolume(camera.position, camera.direction, camera.up);
    // check if overlay position is visible from the camera
    if (cullingVolume.computeVisibility(new Cesium.BoundingSphere(cartesian)) !== 1) {
      this.setVisible(false);
      return;
    }
    this.setVisible(true);
    const pixelCartesian = this.scene_.cartesianToCanvasCoordinates(cartesian);
    const pixel = [pixelCartesian.x, pixelCartesian.y];
    const mapSize = [this.scene_.canvas.width, this.scene_.canvas.height];
    this.updateRenderedPosition(pixel, mapSize);
  }

  /**
   * Destroys the overlay, removing all its listeners and elements
   * @api
   */
  destroy() {
    if (this.scenePostRenderListenerRemover_) {
      this.scenePostRenderListenerRemover_();
    }
    if (this.observer_) {
      this.observer_.disconnect();
    }
    (0,ol_Observable_js__WEBPACK_IMPORTED_MODULE_2__.unByKey)(this.listenerKeys_);
    this.listenerKeys_.splice(0);
    if ('removeNode' in this.element) {
      // @ts-ignore
      this.element.removeNode(true);
    } else {
      this.element.remove();
    }
    this.element = null;
  }
}

/***/ }),

/***/ "./src/olcs/VectorSynchronizer.ts":
/*!****************************************!*\
  !*** ./src/olcs/VectorSynchronizer.ts ***!
  \****************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ VectorSynchronizer)
/* harmony export */ });
/* harmony import */ var ol_source_Vector_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ol/source/Vector.js */ "ol/source/Vector.js");
/* harmony import */ var ol_source_Vector_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(ol_source_Vector_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var ol_layer_Layer_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ol/layer/Layer.js */ "ol/layer/Layer.js");
/* harmony import */ var ol_layer_Layer_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(ol_layer_Layer_js__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var ol_source_Cluster_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ol/source/Cluster.js */ "ol/source/Cluster.js");
/* harmony import */ var ol_source_Cluster_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(ol_source_Cluster_js__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _util__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./util */ "./src/olcs/util.ts");
/* harmony import */ var ol_layer_Vector_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ol/layer/Vector.js */ "ol/layer/Vector.js");
/* harmony import */ var ol_layer_Vector_js__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(ol_layer_Vector_js__WEBPACK_IMPORTED_MODULE_4__);
/* harmony import */ var ol_layer_VectorTile_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ol/layer/VectorTile.js */ "ol/layer/VectorTile.js");
/* harmony import */ var ol_layer_VectorTile_js__WEBPACK_IMPORTED_MODULE_5___default = /*#__PURE__*/__webpack_require__.n(ol_layer_VectorTile_js__WEBPACK_IMPORTED_MODULE_5__);
/* harmony import */ var _AbstractSynchronizer__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./AbstractSynchronizer */ "./src/olcs/AbstractSynchronizer.ts");
/* harmony import */ var _FeatureConverter__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./FeatureConverter */ "./src/olcs/FeatureConverter.ts");









// eslint-disable-next-line no-duplicate-imports

class VectorSynchronizer extends _AbstractSynchronizer__WEBPACK_IMPORTED_MODULE_6__["default"] {
  /**
   * Unidirectionally synchronize OpenLayers vector layers to Cesium.
   */
  constructor(map, scene, opt_converter) {
    super(map, scene);
    this.converter = opt_converter || new _FeatureConverter__WEBPACK_IMPORTED_MODULE_7__["default"](scene);
    this.csAllPrimitives_ = new Cesium.PrimitiveCollection();
    scene.primitives.add(this.csAllPrimitives_);
    this.csAllPrimitives_.destroyPrimitives = false;
  }
  addCesiumObject(counterpart) {
    console.assert(counterpart);
    const collection = counterpart.getRootPrimitive();
    collection.counterpart = counterpart;
    this.csAllPrimitives_.add(counterpart.getRootPrimitive());
  }
  destroyCesiumObject(object) {
    object.getRootPrimitive().destroy();
  }
  removeSingleCesiumObject(object, destroy) {
    object.destroy();
    this.csAllPrimitives_.destroyPrimitives = destroy;
    this.csAllPrimitives_.remove(object.getRootPrimitive());
    this.csAllPrimitives_.destroyPrimitives = false;
  }
  removeAllCesiumObjects(destroy) {
    this.csAllPrimitives_.destroyPrimitives = destroy;
    if (destroy) {
      for (let i = 0; i < this.csAllPrimitives_.length; ++i) {
        this.csAllPrimitives_.get(i)['counterpart'].destroy();
      }
    }
    this.csAllPrimitives_.removeAll();
    this.csAllPrimitives_.destroyPrimitives = false;
  }

  /**
   * Synchronizes the layer visibility properties
   * to the given Cesium Primitive.
   */
  updateLayerVisibility(olLayerWithParents, csPrimitive) {
    let visible = true;
    [olLayerWithParents.layer].concat(olLayerWithParents.parents).forEach(olLayer => {
      const layerVisible = olLayer.getVisible();
      if (layerVisible !== undefined) {
        visible = visible && layerVisible;
      } else {
        visible = false;
      }
    });
    csPrimitive.show = visible;
  }
  createSingleLayerCounterparts(olLayerWithParents) {
    const olLayer = olLayerWithParents.layer;
    if (!(olLayer instanceof (ol_layer_Vector_js__WEBPACK_IMPORTED_MODULE_4___default())) || olLayer instanceof (ol_layer_VectorTile_js__WEBPACK_IMPORTED_MODULE_5___default())) {
      return null;
    }
    console.assert(olLayer instanceof (ol_layer_Layer_js__WEBPACK_IMPORTED_MODULE_1___default()));
    let source = olLayer.getSource();
    if (source instanceof (ol_source_Cluster_js__WEBPACK_IMPORTED_MODULE_2___default())) {
      source = source.getSource();
    }
    if (!source) {
      return null;
    }
    console.assert(source instanceof (ol_source_Vector_js__WEBPACK_IMPORTED_MODULE_0___default()));
    console.assert(this.view);
    const view = this.view;
    const featurePrimitiveMap = {};
    const counterpart = this.converter.olVectorLayerToCesium(olLayer, view, featurePrimitiveMap);
    const csPrimitives = counterpart.getRootPrimitive();
    const olListenKeys = counterpart.olListenKeys;
    [olLayerWithParents.layer].concat(olLayerWithParents.parents).forEach(olLayerItem => {
      olListenKeys.push(olLayerItem.on('change:visible', () => {
        this.updateLayerVisibility(olLayerWithParents, csPrimitives);
      }));
    });
    this.updateLayerVisibility(olLayerWithParents, csPrimitives);
    const onAddFeature = feature => {
      const context = counterpart.context;
      const prim = this.converter.convert(olLayer, view, feature, context);
      if (prim) {
        featurePrimitiveMap[(0,_util__WEBPACK_IMPORTED_MODULE_3__.getUid)(feature)] = prim;
        csPrimitives.add(prim);
      }
    };
    const onRemoveFeature = feature => {
      const id = (0,_util__WEBPACK_IMPORTED_MODULE_3__.getUid)(feature);
      const context = counterpart.context;
      const bbs = context.featureToCesiumMap[id];
      if (bbs) {
        delete context.featureToCesiumMap[id];
        bbs.forEach(bb => {
          if (bb instanceof Cesium.Billboard) {
            context.billboards.remove(bb);
          }
        });
      }
      const csPrimitive = featurePrimitiveMap[id];
      delete featurePrimitiveMap[id];
      if (csPrimitive) {
        csPrimitives.remove(csPrimitive);
      }
    };
    olListenKeys.push(source.on('addfeature', e => {
      console.assert(e.feature);
      onAddFeature(e.feature);
    }));
    olListenKeys.push(source.on('removefeature', e => {
      console.assert(e.feature);
      onRemoveFeature(e.feature);
    }));
    olListenKeys.push(source.on('changefeature', e => {
      const feature = e.feature;
      console.assert(feature);
      onRemoveFeature(feature);
      onAddFeature(feature);
    }));
    return counterpart ? [counterpart] : null;
  }
}

/***/ }),

/***/ "./src/olcs/contrib/LazyLoader.ts":
/*!****************************************!*\
  !*** ./src/olcs/contrib/LazyLoader.ts ***!
  \****************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ LazyLoader)
/* harmony export */ });
class LazyLoader {
  /**
   * @param url
   * @api
   */
  constructor(url) {
    this.url_ = url;
  }

  /**
   * Load Cesium by injecting a script tag.
   * @api
   */
  load() {
    if (!this.promise) {
      // not yet loading
      this.promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.onload = () => resolve();
        script.onerror = () => reject();
        document.head.appendChild(script);
        script.src = this.url_;
      });
    }
    return this.promise;
  }
}

/***/ }),

/***/ "./src/olcs/contrib/Manager.ts":
/*!*************************************!*\
  !*** ./src/olcs/contrib/Manager.ts ***!
  \*************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ Manager)
/* harmony export */ });
/* harmony import */ var _LazyLoader__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./LazyLoader */ "./src/olcs/contrib/LazyLoader.ts");
/* harmony import */ var _OLCesium__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../OLCesium */ "./src/olcs/OLCesium.ts");
/* harmony import */ var _core__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../core */ "./src/olcs/core.ts");
/* harmony import */ var _math__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../math */ "./src/olcs/math.ts");
/* harmony import */ var ol_Observable_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ol/Observable.js */ "ol/Observable.js");
/* harmony import */ var ol_Observable_js__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(ol_Observable_js__WEBPACK_IMPORTED_MODULE_4__);





/**
 * @typedef {Object} ManagerOptions
 * @property {import('ol/Map.js').default} map
 * @property {import('ol/extent.js').Extent} [cameraExtentInRadians]
 * @property {string} [cesiumIonDefaultAccessToken]
 */

class Manager extends (ol_Observable_js__WEBPACK_IMPORTED_MODULE_4___default()) {
  /**
   * @param {string} cesiumUrl
   * @param {olcsx.contrib.ManagerOptions} options
   * @api
   */
  constructor(cesiumUrl, _ref) {
    let {
      map,
      cameraExtentInRadians,
      cesiumIonDefaultAccessToken
    } = _ref;
    super();
    this.cesiumInitialTilt_ = (0,_math__WEBPACK_IMPORTED_MODULE_3__.toRadians)(50);
    this.fogDensity = 0.0001;
    this.fogSSEFactor = 25;
    this.minimumZoomDistance = 2;
    /**
     * Limit the maximum distance to the earth to 10'000km.
     */
    this.maximumZoomDistance = 10000000;
    // when closer to 3000m, restrict the available positions harder
    this.limitCameraToBoundingSphereRatio = height => height > 3000 ? 9 : 3;
    this.cesiumUrl_ = cesiumUrl;
    console.assert(map);
    this.map = map;
    this.cameraExtentInRadians = cameraExtentInRadians || null;
    this.cesiumIonDefaultAccessToken_ = cesiumIonDefaultAccessToken;
  }

  /**
   * Lazy load Cesium.
   */
  load() {
    if (!this.promise_) {
      const cesiumLazyLoader = new _LazyLoader__WEBPACK_IMPORTED_MODULE_0__["default"](this.cesiumUrl_);
      this.promise_ = cesiumLazyLoader.load().then(() => this.onCesiumLoaded());
    }
    return this.promise_;
  }

  /**
   * Hook called when Cesium has been lazy loaded.
   */
  onCesiumLoaded() {
    if (this.cameraExtentInRadians) {
      const rect = new Cesium.Rectangle(...this.cameraExtentInRadians);
      // Set the fly home rectangle
      Cesium.Camera.DEFAULT_VIEW_RECTANGLE = rect;
      this.boundingSphere_ = Cesium.BoundingSphere.fromRectangle3D(rect, Cesium.Ellipsoid.WGS84, 300); // lux mean height is 300m
    }
    if (this.cesiumIonDefaultAccessToken_) {
      Cesium.Ion.defaultAccessToken = this.cesiumIonDefaultAccessToken_;
    }
    this.ol3d = this.instantiateOLCesium();
    const scene = this.ol3d.getCesiumScene();
    this.configureForUsability(scene);
    this.configureForPerformance(scene);
    this.dispatchEvent('load');
    return this.ol3d;
  }

  /**
   * Application code should override this method.
   */
  instantiateOLCesium() {
    const ol3d = new _OLCesium__WEBPACK_IMPORTED_MODULE_1__["default"]({
      map: this.map
    });
    const scene = ol3d.getCesiumScene();
    // LEGACY
    if ('createWorldTerrain' in Cesium) {
      // @ts-ignore
      const terrainProvider = Cesium.createWorldTerrain();
      scene.terrainProvider = terrainProvider;
    } else {
      // v107+
      Cesium.createWorldTerrainAsync().then(tp => scene.terrainProvider = tp);
    }
    return ol3d;
  }

  /**
   * Override with custom performance optimization logics, if needed.
   */
  configureForPerformance(scene) {
    const fog = scene.fog;
    fog.enabled = true;
    fog.density = this.fogDensity;
    fog.screenSpaceErrorFactor = this.fogSSEFactor;
  }

  /**
   * Override with custom usabliity logics, id needed.
   */
  configureForUsability(scene) {
    const sscController = scene.screenSpaceCameraController;
    sscController.minimumZoomDistance = this.minimumZoomDistance;
    sscController.maximumZoomDistance = this.maximumZoomDistance;

    // Do not see through the terrain. Seeing through the terrain does not make
    // sense anyway, except for debugging
    scene.globe.depthTestAgainstTerrain = true;

    // Use white instead of the black default colour for the globe when tiles are missing
    scene.globe.baseColor = Cesium.Color.WHITE;
    scene.backgroundColor = Cesium.Color.WHITE;
    if (this.boundingSphere_) {
      scene.postRender.addEventListener(this.limitCameraToBoundingSphere.bind(this));
    }
    // Stop rendering Cesium when there is nothing to do. This drastically reduces CPU/GPU consumption.
    this.ol3d.enableAutoRenderLoop();
  }

  /**
   * Constrain the camera so that it stays close to the bounding sphere of the map extent.
   * Near the ground the allowed distance is shorter.
   */
  limitCameraToBoundingSphere() {
    const scene = this.ol3d.getCesiumScene();
    (0,_core__WEBPACK_IMPORTED_MODULE_2__.limitCameraToBoundingSphere)(scene.camera, this.boundingSphere_, this.limitCameraToBoundingSphereRatio);
  }

  /**
   * Enable or disable ol3d with a default animation.
   */
  toggle3d() {
    return this.load().then(( /** @const {!olcs.OLCesium} */ol3d) => {
      const is3DCurrentlyEnabled = ol3d.getEnabled();
      const scene = ol3d.getCesiumScene();
      if (is3DCurrentlyEnabled) {
        // Disable 3D
        console.assert(this.map);
        return (0,_core__WEBPACK_IMPORTED_MODULE_2__.resetToNorthZenith)(this.map, scene).then(() => {
          ol3d.setEnabled(false);
          this.dispatchEvent('toggle');
        });
      } else {
        // Enable 3D
        ol3d.setEnabled(true);
        this.dispatchEvent('toggle');
        return (0,_core__WEBPACK_IMPORTED_MODULE_2__.rotateAroundBottomCenter)(scene, this.cesiumInitialTilt_);
      }
    });
  }

  /**
   * Enable ol3d with a view built from parameters.
   */
  set3dWithView(lon, lat, elevation, headingDeg, pitchDeg) {
    return this.load().then(ol3d => {
      const is3DCurrentlyEnabled = ol3d.getEnabled();
      const scene = ol3d.getCesiumScene();
      const camera = scene.camera;
      const destination = Cesium.Cartesian3.fromDegrees(lon, lat, elevation);
      const heading = Cesium.Math.toRadians(headingDeg);
      const pitch = Cesium.Math.toRadians(pitchDeg);
      const roll = 0;
      const orientation = {
        heading,
        pitch,
        roll
      };
      if (!is3DCurrentlyEnabled) {
        ol3d.setEnabled(true);
        this.dispatchEvent('toggle');
      }
      camera.setView({
        destination,
        orientation
      });
    });
  }

  /**
   * Whether OL-Cesium has been loaded and 3D mode is enabled.
   */
  is3dEnabled() {
    return !!this.ol3d && this.ol3d.getEnabled();
  }

  /**
   * @return {number}
   */
  getHeading() {
    return this.map ? this.map.getView().getRotation() || 0 : 0;
  }

  /**
   * @return {number|undefined}
   */
  getTiltOnGlobe() {
    const scene = this.ol3d.getCesiumScene();
    const tiltOnGlobe = (0,_core__WEBPACK_IMPORTED_MODULE_2__.computeSignedTiltAngleOnGlobe)(scene);
    return -tiltOnGlobe;
  }

  /**
   * Set heading.
   * This assumes ol3d has been loaded.
   */
  setHeading(angle) {
    const scene = this.ol3d.getCesiumScene();
    const bottom = (0,_core__WEBPACK_IMPORTED_MODULE_2__.pickBottomPoint)(scene);
    if (bottom) {
      (0,_core__WEBPACK_IMPORTED_MODULE_2__.setHeadingUsingBottomCenter)(scene, angle, bottom);
    }
  }
  getOl3d() {
    return this.ol3d;
  }
  getCesiumViewMatrix() {
    return this.ol3d.getCesiumScene().camera.viewMatrix;
  }
  getCesiumScene() {
    return this.ol3d.getCesiumScene();
  }

  /**
   * Fly to some rectangle.
   * This assumes ol3d has been loaded.
   */
  flyToRectangle(rectangle, offset) {
    if (offset === void 0) {
      offset = 0;
    }
    const camera = this.getCesiumScene().camera;
    const destination = camera.getRectangleCameraCoordinates(rectangle);
    const mag = Cesium.Cartesian3.magnitude(destination) + offset;
    Cesium.Cartesian3.normalize(destination, destination);
    Cesium.Cartesian3.multiplyByScalar(destination, mag, destination);
    return new Promise((resolve, reject) => {
      if (!this.cameraExtentInRadians) {
        reject();
        return;
      }
      camera.flyTo({
        destination,
        complete: () => resolve(),
        cancel: () => reject(),
        endTransform: Cesium.Matrix4.IDENTITY
      });
    });
  }
}

/***/ }),

/***/ "./src/olcs/core.ts":
/*!**************************!*\
  !*** ./src/olcs/core.ts ***!
  \**************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   applyHeightOffsetToGeometry: () => (/* binding */ applyHeightOffsetToGeometry),
/* harmony export */   attributionsFunctionToCredits: () => (/* binding */ attributionsFunctionToCredits),
/* harmony export */   bottomFovRay: () => (/* binding */ bottomFovRay),
/* harmony export */   calcDistanceForResolution: () => (/* binding */ calcDistanceForResolution),
/* harmony export */   calcResolutionForDistance: () => (/* binding */ calcResolutionForDistance),
/* harmony export */   computeAngleToZenith: () => (/* binding */ computeAngleToZenith),
/* harmony export */   computeBoundingBoxAtTarget: () => (/* binding */ computeBoundingBoxAtTarget),
/* harmony export */   computePixelSizeAtCoordinate: () => (/* binding */ computePixelSizeAtCoordinate),
/* harmony export */   computeSignedTiltAngleOnGlobe: () => (/* binding */ computeSignedTiltAngleOnGlobe),
/* harmony export */   convertColorToCesium: () => (/* binding */ convertColorToCesium),
/* harmony export */   convertUrlToCesium: () => (/* binding */ convertUrlToCesium),
/* harmony export */   createMatrixAtCoordinates: () => (/* binding */ createMatrixAtCoordinates),
/* harmony export */   extentToRectangle: () => (/* binding */ extentToRectangle),
/* harmony export */   isCesiumProjection: () => (/* binding */ isCesiumProjection),
/* harmony export */   limitCameraToBoundingSphere: () => (/* binding */ limitCameraToBoundingSphere),
/* harmony export */   normalizeView: () => (/* binding */ normalizeView),
/* harmony export */   ol4326CoordinateArrayToCsCartesians: () => (/* binding */ ol4326CoordinateArrayToCsCartesians),
/* harmony export */   ol4326CoordinateToCesiumCartesian: () => (/* binding */ ol4326CoordinateToCesiumCartesian),
/* harmony export */   olGeometryCloneTo4326: () => (/* binding */ olGeometryCloneTo4326),
/* harmony export */   pickBottomPoint: () => (/* binding */ pickBottomPoint),
/* harmony export */   pickCenterPoint: () => (/* binding */ pickCenterPoint),
/* harmony export */   pickOnTerrainOrEllipsoid: () => (/* binding */ pickOnTerrainOrEllipsoid),
/* harmony export */   resetToNorthZenith: () => (/* binding */ resetToNorthZenith),
/* harmony export */   rotateAroundAxis: () => (/* binding */ rotateAroundAxis),
/* harmony export */   rotateAroundBottomCenter: () => (/* binding */ rotateAroundBottomCenter),
/* harmony export */   setHeadingUsingBottomCenter: () => (/* binding */ setHeadingUsingBottomCenter),
/* harmony export */   signedAngleBetween: () => (/* binding */ signedAngleBetween),
/* harmony export */   sourceToImageryProvider: () => (/* binding */ sourceToImageryProvider),
/* harmony export */   tileLayerToImageryLayer: () => (/* binding */ tileLayerToImageryLayer),
/* harmony export */   updateCesiumLayerProperties: () => (/* binding */ updateCesiumLayerProperties)
/* harmony export */ });
/* harmony import */ var ol_easing_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ol/easing.js */ "ol/easing.js");
/* harmony import */ var ol_easing_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(ol_easing_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var ol_layer_Tile_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ol/layer/Tile.js */ "ol/layer/Tile.js");
/* harmony import */ var ol_layer_Tile_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(ol_layer_Tile_js__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var ol_layer_Image_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ol/layer/Image.js */ "ol/layer/Image.js");
/* harmony import */ var ol_layer_Image_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(ol_layer_Image_js__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var ol_proj_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ol/proj.js */ "ol/proj.js");
/* harmony import */ var ol_proj_js__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(ol_proj_js__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var ol_source_ImageStatic_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ol/source/ImageStatic.js */ "ol/source/ImageStatic.js");
/* harmony import */ var ol_source_ImageStatic_js__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(ol_source_ImageStatic_js__WEBPACK_IMPORTED_MODULE_4__);
/* harmony import */ var ol_source_ImageWMS_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ol/source/ImageWMS.js */ "ol/source/ImageWMS.js");
/* harmony import */ var ol_source_ImageWMS_js__WEBPACK_IMPORTED_MODULE_5___default = /*#__PURE__*/__webpack_require__.n(ol_source_ImageWMS_js__WEBPACK_IMPORTED_MODULE_5__);
/* harmony import */ var ol_source_TileImage_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ol/source/TileImage.js */ "ol/source/TileImage.js");
/* harmony import */ var ol_source_TileImage_js__WEBPACK_IMPORTED_MODULE_6___default = /*#__PURE__*/__webpack_require__.n(ol_source_TileImage_js__WEBPACK_IMPORTED_MODULE_6__);
/* harmony import */ var ol_source_TileWMS_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ol/source/TileWMS.js */ "ol/source/TileWMS.js");
/* harmony import */ var ol_source_TileWMS_js__WEBPACK_IMPORTED_MODULE_7___default = /*#__PURE__*/__webpack_require__.n(ol_source_TileWMS_js__WEBPACK_IMPORTED_MODULE_7__);
/* harmony import */ var ol_source_VectorTile_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ol/source/VectorTile.js */ "ol/source/VectorTile.js");
/* harmony import */ var ol_source_VectorTile_js__WEBPACK_IMPORTED_MODULE_8___default = /*#__PURE__*/__webpack_require__.n(ol_source_VectorTile_js__WEBPACK_IMPORTED_MODULE_8__);
/* harmony import */ var ol_source_Image_js__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ol/source/Image.js */ "ol/source/Image.js");
/* harmony import */ var ol_source_Image_js__WEBPACK_IMPORTED_MODULE_9___default = /*#__PURE__*/__webpack_require__.n(ol_source_Image_js__WEBPACK_IMPORTED_MODULE_9__);
/* harmony import */ var _core_OLImageryProvider__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! ./core/OLImageryProvider */ "./src/olcs/core/OLImageryProvider.ts");
/* harmony import */ var _util__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(/*! ./util */ "./src/olcs/util.ts");
/* harmony import */ var _MVTImageryProvider__WEBPACK_IMPORTED_MODULE_12__ = __webpack_require__(/*! ./MVTImageryProvider */ "./src/olcs/MVTImageryProvider.ts");
/* harmony import */ var ol_layer_VectorTile_js__WEBPACK_IMPORTED_MODULE_13__ = __webpack_require__(/*! ol/layer/VectorTile.js */ "ol/layer/VectorTile.js");
/* harmony import */ var ol_layer_VectorTile_js__WEBPACK_IMPORTED_MODULE_13___default = /*#__PURE__*/__webpack_require__.n(ol_layer_VectorTile_js__WEBPACK_IMPORTED_MODULE_13__);
/* harmony import */ var ol_extent_js__WEBPACK_IMPORTED_MODULE_14__ = __webpack_require__(/*! ol/extent.js */ "ol/extent.js");
/* harmony import */ var ol_extent_js__WEBPACK_IMPORTED_MODULE_14___default = /*#__PURE__*/__webpack_require__.n(ol_extent_js__WEBPACK_IMPORTED_MODULE_14__);
















// eslint-disable-next-line no-duplicate-imports

/**
 * Options for rotate around axis core function.
 */

/**
 * Compute the pixel width and height of a point in meters using the
 * camera frustum.
 */
function computePixelSizeAtCoordinate(scene, target) {
  const camera = scene.camera;
  const canvas = scene.canvas;
  const frustum = camera.frustum;
  const distance = Cesium.Cartesian3.magnitude(Cesium.Cartesian3.subtract(camera.position, target, new Cesium.Cartesian3()));
  // @ts-ignore TS2341
  return frustum.getPixelDimensions(canvas.clientWidth, canvas.clientHeight, distance, scene.pixelRatio, new Cesium.Cartesian2());
}

/**
 * Compute bounding box around a target point.
 * @param {!Cesium.Scene} scene
 * @param {!Cesium.Cartesian3} target
 * @param {number} amount Half the side of the box, in pixels.
 * @return {Array<Cesium.Cartographic>} bottom left and top right
 * coordinates of the box
 */
function computeBoundingBoxAtTarget(scene, target, amount) {
  const pixelSize = computePixelSizeAtCoordinate(scene, target);
  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(target);
  const bottomLeft = Cesium.Matrix4.multiplyByPoint(transform, new Cesium.Cartesian3(-pixelSize.x * amount, -pixelSize.y * amount, 0), new Cesium.Cartesian3());
  const topRight = Cesium.Matrix4.multiplyByPoint(transform, new Cesium.Cartesian3(pixelSize.x * amount, pixelSize.y * amount, 0), new Cesium.Cartesian3());
  return Cesium.Ellipsoid.WGS84.cartesianArrayToCartographicArray([bottomLeft, topRight]);
}
function applyHeightOffsetToGeometry(geometry, height) {
  geometry.applyTransform((input, output, stride) => {
    console.assert(input === output);
    if (stride !== undefined && stride >= 3) {
      for (let i = 0; i < output.length; i += stride) {
        output[i + 2] = output[i + 2] + height;
      }
    }
    return output;
  });
}
function createMatrixAtCoordinates(coordinates, rotation, translation, scale) {
  if (rotation === void 0) {
    rotation = 0;
  }
  if (translation === void 0) {
    translation = Cesium.Cartesian3.ZERO;
  }
  if (scale === void 0) {
    scale = new Cesium.Cartesian3(1, 1, 1);
  }
  const position = ol4326CoordinateToCesiumCartesian(coordinates);
  const rawMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(position);
  const quaternion = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_Z, -rotation);
  const rotationMatrix = Cesium.Matrix4.fromTranslationQuaternionRotationScale(translation, quaternion, scale);
  return Cesium.Matrix4.multiply(rawMatrix, rotationMatrix, new Cesium.Matrix4());
}
function rotateAroundAxis(camera, angle, axis, transform, opt_options) {
  const clamp = Cesium.Math.clamp;
  const defaultValue = Cesium.defaultValue;
  const options = opt_options;
  const duration = defaultValue(options == null ? void 0 : options.duration, 500); // ms
  const easing = defaultValue(options == null ? void 0 : options.easing, ol_easing_js__WEBPACK_IMPORTED_MODULE_0__.linear);
  const callback = options == null ? void 0 : options.callback;
  let lastProgress = 0;
  const oldTransform = new Cesium.Matrix4();
  const start = Date.now();
  const step = function () {
    const timestamp = Date.now();
    const timeDifference = timestamp - start;
    const progress = easing(clamp(timeDifference / duration, 0, 1));
    console.assert(progress >= lastProgress);
    camera.transform.clone(oldTransform);
    const stepAngle = (progress - lastProgress) * angle;
    lastProgress = progress;
    camera.lookAtTransform(transform);
    camera.rotate(axis, stepAngle);
    camera.lookAtTransform(oldTransform);
    if (progress < 1) {
      window.requestAnimationFrame(step);
    } else {
      if (callback) {
        callback();
      }
    }
  };
  window.requestAnimationFrame(step);
}
function setHeadingUsingBottomCenter(scene, heading, bottomCenter, options) {
  const camera = scene.camera;
  // Compute the camera position to zenith quaternion
  const angleToZenith = computeAngleToZenith(scene, bottomCenter);
  const axis = camera.right;
  const quaternion = Cesium.Quaternion.fromAxisAngle(axis, angleToZenith);
  const rotation = Cesium.Matrix3.fromQuaternion(quaternion);

  // Get the zenith point from the rotation of the position vector
  const vector = new Cesium.Cartesian3();
  Cesium.Cartesian3.subtract(camera.position, bottomCenter, vector);
  const zenith = new Cesium.Cartesian3();
  Cesium.Matrix3.multiplyByVector(rotation, vector, zenith);
  Cesium.Cartesian3.add(zenith, bottomCenter, zenith);

  // Actually rotate around the zenith normal
  const transform = Cesium.Matrix4.fromTranslation(zenith);
  rotateAroundAxis(camera, heading, zenith, transform, options);
}

/**
 * Get the 3D position of the given pixel of the canvas.
 */
function pickOnTerrainOrEllipsoid(scene, pixel) {
  const ray = scene.camera.getPickRay(pixel);
  const target = scene.globe.pick(ray, scene);
  return target || scene.camera.pickEllipsoid(pixel);
}

/**
 * Get the 3D position of the point at the bottom-center of the screen.
 */
function pickBottomPoint(scene) {
  const canvas = scene.canvas;
  const bottom = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight);
  return pickOnTerrainOrEllipsoid(scene, bottom);
}

/**
 * Get the 3D position of the point at the center of the screen.
 */
function pickCenterPoint(scene) {
  const canvas = scene.canvas;
  const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  return pickOnTerrainOrEllipsoid(scene, center);
}

/**
 * Compute the signed tilt angle on globe, between the opposite of the
 * camera direction and the target normal. Return undefined if there is no
 */
function computeSignedTiltAngleOnGlobe(scene) {
  const camera = scene.camera;
  const ray = new Cesium.Ray(camera.position, camera.direction);
  let target = scene.globe.pick(ray, scene);
  if (!target) {
    // no tiles in the area were loaded?
    const ellipsoid = Cesium.Ellipsoid.WGS84;
    const obj = Cesium.IntersectionTests.rayEllipsoid(ray, ellipsoid);
    if (obj) {
      target = Cesium.Ray.getPoint(ray, obj.start);
    }
  }
  if (!target) {
    return undefined;
  }
  const normal = new Cesium.Cartesian3();
  Cesium.Ellipsoid.WGS84.geocentricSurfaceNormal(target, normal);
  const angleBetween = signedAngleBetween;
  const angle = angleBetween(camera.direction, normal, camera.right) - Math.PI;
  return Cesium.Math.convertLongitudeRange(angle);
}

/**
 * Compute the ray from the camera to the bottom-center of the screen.
 */
function bottomFovRay(scene) {
  const camera = scene.camera;
  // @ts-ignore TS2341
  const fovy2 = camera.frustum.fovy / 2;
  const direction = camera.direction;
  const rotation = Cesium.Quaternion.fromAxisAngle(camera.right, fovy2);
  const matrix = Cesium.Matrix3.fromQuaternion(rotation);
  const vector = new Cesium.Cartesian3();
  Cesium.Matrix3.multiplyByVector(matrix, direction, vector);
  return new Cesium.Ray(camera.position, vector);
}

/**
 * Compute the angle between two Cartesian3.
 */
function signedAngleBetween(first, second, normal) {
  // We are using the dot for the angle.
  // Then the cross and the dot for the sign.
  const a = new Cesium.Cartesian3();
  const b = new Cesium.Cartesian3();
  const c = new Cesium.Cartesian3();
  Cesium.Cartesian3.normalize(first, a);
  Cesium.Cartesian3.normalize(second, b);
  Cesium.Cartesian3.cross(a, b, c);
  const cosine = Cesium.Cartesian3.dot(a, b);
  const sine = Cesium.Cartesian3.magnitude(c);

  // Sign of the vector product and the orientation normal
  const sign = Cesium.Cartesian3.dot(normal, c);
  const angle = Math.atan2(sine, cosine);
  return sign >= 0 ? angle : -angle;
}

/**
 * Compute the rotation angle around a given point, needed to reach the
 * zenith position.
 * At a zenith position, the camera direction is going througth the earth
 * center and the frustrum bottom ray is going through the chosen pivot
 * point.
 * The bottom-center of the screen is a good candidate for the pivot point.
 */
function computeAngleToZenith(scene, pivot) {
  // This angle is the sum of the angles 'fy' and 'a', which are defined
  // using the pivot point and its surface normal.
  //        Zenith |    camera
  //           \   |   /
  //            \fy|  /
  //             \ |a/
  //              \|/pivot
  const camera = scene.camera;
  // @ts-ignore TS2341
  const fy = camera.frustum.fovy / 2;
  const ray = bottomFovRay(scene);
  const direction = Cesium.Cartesian3.clone(ray.direction);
  Cesium.Cartesian3.negate(direction, direction);
  const normal = new Cesium.Cartesian3();
  Cesium.Ellipsoid.WGS84.geocentricSurfaceNormal(pivot, normal);
  const left = new Cesium.Cartesian3();
  Cesium.Cartesian3.negate(camera.right, left);
  const a = signedAngleBetween(normal, direction, left);
  return a + fy;
}

/**
 * Convert an OpenLayers extent to a Cesium rectangle.
 * @param {ol.Extent} extent Extent.
 * @param {ol.ProjectionLike} projection Extent projection.
 * @return {Cesium.Rectangle} The corresponding Cesium rectangle.
 */
function extentToRectangle(extent, projection) {
  if (extent && projection) {
    const ext = (0,ol_proj_js__WEBPACK_IMPORTED_MODULE_3__.transformExtent)(extent, projection, 'EPSG:4326');
    return Cesium.Rectangle.fromDegrees(ext[0], ext[1], ext[2], ext[3]);
  } else {
    return null;
  }
}
function sourceToImageryProvider(olMap, source, viewProj, olLayer) {
  const skip = source.get('olcs_skip');
  if (skip) {
    return null;
  }
  let provider = null;
  // Convert ImageWMS to TileWMS
  if (source instanceof (ol_source_ImageWMS_js__WEBPACK_IMPORTED_MODULE_5___default()) && source.getUrl() && source.getImageLoadFunction() === ol_source_Image_js__WEBPACK_IMPORTED_MODULE_9__.defaultImageLoadFunction) {
    const sourceProps = {
      'olcs.proxy': source.get('olcs.proxy'),
      'olcs.extent': source.get('olcs.extent'),
      'olcs.projection': source.get('olcs.projection'),
      'olcs.imagesource': source
    };
    source = new (ol_source_TileWMS_js__WEBPACK_IMPORTED_MODULE_7___default())({
      url: source.getUrl(),
      attributions: source.getAttributions(),
      projection: source.getProjection(),
      params: source.getParams()
    });
    source.setProperties(sourceProps);
  }
  if (source instanceof (ol_source_TileImage_js__WEBPACK_IMPORTED_MODULE_6___default())) {
    let projection = (0,_util__WEBPACK_IMPORTED_MODULE_11__.getSourceProjection)(source);
    if (!projection) {
      // if not explicit, assume the same projection as view
      projection = viewProj;
    }
    if (isCesiumProjection(projection)) {
      provider = new _core_OLImageryProvider__WEBPACK_IMPORTED_MODULE_10__["default"](olMap, source, viewProj);
    }
    // Projection not supported by Cesium
    else {
      return null;
    }
  } else if (source instanceof (ol_source_ImageStatic_js__WEBPACK_IMPORTED_MODULE_4___default())) {
    let projection = (0,_util__WEBPACK_IMPORTED_MODULE_11__.getSourceProjection)(source);
    if (!projection) {
      projection = viewProj;
    }
    if (isCesiumProjection(projection)) {
      const rectangle = Cesium.Rectangle.fromDegrees(source.getImageExtent()[0], source.getImageExtent()[1], source.getImageExtent()[2], source.getImageExtent()[3], new Cesium.Rectangle());
      provider = new Cesium.SingleTileImageryProvider({
        url: source.getUrl(),
        rectangle
      });
    }
    // Projection not supported by Cesium
    else {
      return null;
    }
  } else if (source instanceof (ol_source_VectorTile_js__WEBPACK_IMPORTED_MODULE_8___default()) && olLayer instanceof (ol_layer_VectorTile_js__WEBPACK_IMPORTED_MODULE_13___default())) {
    let projection = (0,_util__WEBPACK_IMPORTED_MODULE_11__.getSourceProjection)(source);
    if (!projection) {
      projection = viewProj;
    }
    if (skip === false) {
      // MVT is experimental, it should be whitelisted to be synchronized
      const fromCode = projection.getCode().split(':')[1];
      // @ts-ignore TS2341
      const urls = source.urls.map(u => u.replace(fromCode, '3857'));
      const extent = olLayer.getExtent();
      const rectangle = extentToRectangle(extent, projection);
      const minimumLevel = source.get('olcs_minimumLevel');
      const attributionsFunction = source.getAttributions();
      const styleFunction = olLayer.getStyleFunction();
      let credit;
      if (extent && attributionsFunction) {
        const center = (0,ol_extent_js__WEBPACK_IMPORTED_MODULE_14__.getCenter)(extent);
        // disattivo le attribuzioni perché nel mio caso sono una legenda
        //credit = attributionsFunctionToCredits(attributionsFunction, 0, center, extent)[0];
      }
      provider = new _MVTImageryProvider__WEBPACK_IMPORTED_MODULE_12__["default"]({
        credit,
        rectangle,
        minimumLevel,
        styleFunction,
        urls
      });
      return provider;
    }
    return null; // FIXME: it is disabled by default right now
  } else {
    // sources other than TileImage|Imageexport function are currently not supported
    return null;
  }
  return provider;
}

/**
 * Creates Cesium.ImageryLayer best corresponding to the given ol.layer.Layer.
 * Only supports raster layers and export function images
 */
function tileLayerToImageryLayer(olMap, olLayer, viewProj) {
  if (!(olLayer instanceof (ol_layer_Tile_js__WEBPACK_IMPORTED_MODULE_1___default())) && !(olLayer instanceof (ol_layer_Image_js__WEBPACK_IMPORTED_MODULE_2___default())) && !(olLayer instanceof (ol_layer_VectorTile_js__WEBPACK_IMPORTED_MODULE_13___default()))) {
    return null;
  }
  const source = olLayer.getSource();
  if (!source) {
    return null;
  }
  let provider = source.get('olcs_provider');
  if (!provider) {
    provider = sourceToImageryProvider(olMap, source, viewProj, olLayer);
  }
  if (!provider) {
    return null;
  }
  const layerOptions = {};
  const forcedExtent = olLayer.get('olcs.extent');
  const ext = forcedExtent || olLayer.getExtent();
  if (ext) {
    layerOptions.rectangle = extentToRectangle(ext, viewProj);
  }
  const cesiumLayer = new Cesium.ImageryLayer(provider, layerOptions);
  return cesiumLayer;
}

/**
 * Synchronizes the layer rendering properties (opacity, visible)
 * to the given Cesium ImageryLayer.
 */
function updateCesiumLayerProperties(olLayerWithParents, csLayer) {
  let opacity = 1;
  let visible = true;
  [olLayerWithParents.layer].concat(olLayerWithParents.parents).forEach(olLayer => {
    const layerOpacity = olLayer.getOpacity();
    if (layerOpacity !== undefined) {
      opacity *= layerOpacity;
    }
    const layerVisible = olLayer.getVisible();
    if (layerVisible !== undefined) {
      visible = visible && layerVisible;
    }
  });
  csLayer.alpha = opacity;
  csLayer.show = visible;
}

/**
 * Convert a 2D or 3D OpenLayers coordinate to Cesium.
 */
function ol4326CoordinateToCesiumCartesian(coordinate) {
  const coo = coordinate;
  return coo.length > 2 ? Cesium.Cartesian3.fromDegrees(coo[0], coo[1], coo[2]) : Cesium.Cartesian3.fromDegrees(coo[0], coo[1]);
}

/**
 * Convert an array of 2D or 3D OpenLayers coordinates to Cesium.
 */
function ol4326CoordinateArrayToCsCartesians(coordinates) {
  console.assert(coordinates !== null);
  const toCartesian = ol4326CoordinateToCesiumCartesian;
  const cartesians = [];
  for (let i = 0; i < coordinates.length; ++i) {
    cartesians.push(toCartesian(coordinates[i]));
  }
  return cartesians;
}

/**
 * Reproject an OpenLayers geometry to EPSG:4326 if needed.
 * The geometry will be cloned only when original projection is not EPSG:4326
 * and the properties will be shallow copied.
 */
function olGeometryCloneTo4326(geometry, projection) {
  console.assert(projection);
  const proj4326 = (0,ol_proj_js__WEBPACK_IMPORTED_MODULE_3__.get)('EPSG:4326');
  const proj = (0,ol_proj_js__WEBPACK_IMPORTED_MODULE_3__.get)(projection);
  if (proj.getCode() !== proj4326.getCode()) {
    const properties = geometry.getProperties();
    geometry = geometry.clone();
    geometry.transform(proj, proj4326);
    geometry.setProperties(properties);
  }
  return geometry;
}

/**
 * Convert an OpenLayers color to Cesium.
 */
function convertColorToCesium(olColor) {
  olColor = olColor || 'black';
  if (Array.isArray(olColor)) {
    return new Cesium.Color(Cesium.Color.byteToFloat(olColor[0]), Cesium.Color.byteToFloat(olColor[1]), Cesium.Color.byteToFloat(olColor[2]), olColor[3]);
  } else if (typeof olColor == 'string') {
    return Cesium.Color.fromCssColorString(olColor);
  } else if (olColor instanceof CanvasPattern || olColor instanceof CanvasGradient) {
    // Render the CanvasPattern/CanvasGradient into a canvas that will be sent to Cesium as material
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.height = 256;
    ctx.fillStyle = olColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return new Cesium.ImageMaterialProperty({
      image: canvas
    });
  }
  console.assert(false, 'impossible');
}

/**
 * Convert an OpenLayers url to Cesium.
 */
function convertUrlToCesium(url) {
  let subdomains = '';
  const re = /\{(\d|[a-z])-(\d|[a-z])\}/;
  const match = re.exec(url);
  if (match) {
    url = url.replace(re, '{s}');
    const startCharCode = match[1].charCodeAt(0);
    const stopCharCode = match[2].charCodeAt(0);
    let charCode;
    for (charCode = startCharCode; charCode <= stopCharCode; ++charCode) {
      subdomains += String.fromCharCode(charCode);
    }
  }
  return {
    url,
    subdomains
  };
}

/**
 * Animate the return to a top-down view from the zenith.
 * The camera is rotated to orient to the North.
 */
function resetToNorthZenith(map, scene) {
  return new Promise((resolve, reject) => {
    const camera = scene.camera;
    const pivot = pickBottomPoint(scene);
    if (!pivot) {
      reject('Could not get bottom pivot');
      return;
    }
    const currentHeading = map.getView().getRotation();
    if (currentHeading === undefined) {
      reject('The view is not initialized');
      return;
    }
    const angle = computeAngleToZenith(scene, pivot);

    // Point to North
    setHeadingUsingBottomCenter(scene, currentHeading, pivot);

    // Go to zenith
    const transform = Cesium.Matrix4.fromTranslation(pivot);
    const axis = camera.right;
    const options = {
      callback: () => {
        const view = map.getView();
        normalizeView(view);
        resolve(undefined);
      }
    };
    rotateAroundAxis(camera, -angle, axis, transform, options);
  });
}

/**
 * @param {!Cesium.Scene} scene
 * @param {number} angle in radian
 * @return {Promise<undefined>}
 * @api
 */
function rotateAroundBottomCenter(scene, angle) {
  return new Promise((resolve, reject) => {
    const camera = scene.camera;
    const pivot = pickBottomPoint(scene);
    if (!pivot) {
      reject('could not get bottom pivot');
      return;
    }
    const options = {
      callback: () => resolve(undefined)
    };
    const transform = Cesium.Matrix4.fromTranslation(pivot);
    const axis = camera.right;
    rotateAroundAxis(camera, -angle, axis, transform, options);
  });
}

/**
 * Set the OpenLayers view to a specific rotation and
 * the nearest resolution.
 */
function normalizeView(view, angle) {
  if (angle === void 0) {
    angle = 0;
  }
  const resolution = view.getResolution();
  view.setRotation(angle);

  // @ts-ignore TS2341
  if (view.constrainResolution) {
    // @ts-ignore TS2341
    view.setResolution(view.constrainResolution(resolution));
  } else {
    view.setResolution(view.getConstrainedResolution(resolution));
  }
}

/**
 * Check if the given projection is managed by Cesium (WGS84 or Mercator Spheric)
 */
function isCesiumProjection(projection) {
  const is3857 = projection.getCode() === 'EPSG:3857';
  const is4326 = projection.getCode() === 'EPSG:4326';
  return is3857 || is4326;
}
function attributionsFunctionToCredits(attributionsFunction, zoom, center, extent) {
  if (!attributionsFunction) {
    return [];
  }
  let attributions = attributionsFunction({
    viewState: {
      zoom,
      center,
      projection: undefined,
      resolution: undefined,
      rotation: undefined
    },
    extent
  });
  if (!Array.isArray(attributions)) {
    attributions = [attributions];
  }
  return attributions.map(html => new Cesium.Credit(html, true));
}

/**
 * calculate the distance between camera and centerpoint based on the resolution and latitude value
 */
function calcDistanceForResolution(resolution, latitude, scene, projection) {
  const canvas = scene.canvas;
  const camera = scene.camera;
  // @ts-ignore TS2341
  const fovy = camera.frustum.fovy; // vertical field of view
  console.assert(!isNaN(fovy));
  const metersPerUnit = projection.getMetersPerUnit();

  // number of "map units" visible in 2D (vertically)
  const visibleMapUnits = resolution * canvas.clientHeight;

  // The metersPerUnit does not take latitude into account, but it should
  // be lower with increasing latitude -- we have to compensate.
  // In 3D it is not possible to maintain the resolution at more than one point,
  // so it only makes sense to use the latitude of the "target" point.
  const relativeCircumference = Math.cos(Math.abs(latitude));

  // how many meters should be visible in 3D
  const visibleMeters = visibleMapUnits * metersPerUnit * relativeCircumference;

  // distance required to view the calculated length in meters
  //
  //  fovy/2
  //    |\
  //  x | \
  //    |--\
  // visibleMeters/2
  const requiredDistance = visibleMeters / 2 / Math.tan(fovy / 2);

  // NOTE: This calculation is not absolutely precise, because metersPerUnit
  // is a great simplification. It does not take ellipsoid/terrain into account.

  return requiredDistance;
}

/**
 * calculate the resolution based on a distance(camera to position) and latitude value
 */
function calcResolutionForDistance(distance, latitude, scene, projection) {
  // See the reverse calculation (calcDistanceForResolution) for details
  const canvas = scene.canvas;
  const camera = scene.camera;
  // @ts-ignore TS2341
  const fovy = camera.frustum.fovy; // vertical field of view
  console.assert(!isNaN(fovy));
  const metersPerUnit = projection.getMetersPerUnit();
  const visibleMeters = 2 * distance * Math.tan(fovy / 2);
  const relativeCircumference = Math.cos(Math.abs(latitude));
  const visibleMapUnits = visibleMeters / metersPerUnit / relativeCircumference;
  const resolution = visibleMapUnits / canvas.clientHeight;
  return resolution;
}

/**
 * Constrain the camera so that it stays close to the bounding sphere of the map extent.
 * Near the ground the allowed distance is shorter.
 */
function limitCameraToBoundingSphere(camera, boundingSphere, ratio) {
  let blockLimiter = false;
  return function () {
    if (!blockLimiter) {
      const position = camera.position;
      const carto = Cesium.Cartographic.fromCartesian(position);
      if (Cesium.Cartesian3.distance(boundingSphere.center, position) > boundingSphere.radius * ratio(carto.height)) {
        // @ts-ignore TS2339: FIXME, there is no flying property in Camera
        const currentlyFlying = camera.flying;
        if (currentlyFlying === true) {
          // There is a flying property and its value is true
          return;
        } else {
          blockLimiter = true;
          const unblockLimiter = () => blockLimiter = false;
          camera.flyToBoundingSphere(boundingSphere, {
            complete: unblockLimiter,
            cancel: unblockLimiter
          });
        }
      }
    }
  };
}

/***/ }),

/***/ "./src/olcs/core/OLImageryProvider.ts":
/*!********************************************!*\
  !*** ./src/olcs/core/OLImageryProvider.ts ***!
  \********************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   createEmptyCanvas: () => (/* binding */ createEmptyCanvas),
/* harmony export */   "default": () => (/* binding */ OLImageryProvider)
/* harmony export */ });
/* harmony import */ var _util__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../util */ "./src/olcs/util.ts");
/* harmony import */ var ol_source_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ol/source.js */ "ol/source.js");
/* harmony import */ var ol_source_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(ol_source_js__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _core__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../core */ "./src/olcs/core.ts");



function createEmptyCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas;
}
const olUseNewCoordinates = function () {
  const tileSource = new ol_source_js__WEBPACK_IMPORTED_MODULE_1__.Tile({
    projection: 'EPSG:3857',
    wrapX: true
  });
  const tileCoord = tileSource.getTileCoordForTileUrlFunction([6, -31, 22]);
  return tileCoord && tileCoord[1] === 33 && tileCoord[2] === 22;
  // See b/test/spec/ol/source/tile.test.js
  // of e9a30c5cb7e3721d9370025fbe5472c322847b35 in OpenLayers repository
}();
class OLImageryProvider /* should not extend Cesium.ImageryProvider */{
  /**
  * When <code>true</code>, this model is ready to render, i.e., the external binary, image,
  * and shader files were downloaded and the WebGL resources were created.
  */
  get ready() {
    return this.ready_;
  }

  /**
  * Gets the rectangle, in radians, of the imagery provided by the instance.
  */
  get rectangle() {
    return this.rectangle_;
  }

  /**
   * Gets the tiling scheme used by the provider.
   */
  get tilingScheme() {
    return this.tilingScheme_;
  }

  /**
   * Gets an event that is raised when the imagery provider encounters an asynchronous error.  By subscribing
   * to the event, you will be notified of the error and can potentially recover from it.  Event listeners
   * are passed an instance of {@link Cesium.TileProviderError}.
   */

  /**
   * Gets the credit to display when this imagery provider is active.  Typically this is used to credit
   * the source of the imagery.
   */

  /**
   * Gets the proxy used by this provider.
   */

  get _ready() {
    return this.ready_;
  }

  /**
   * Gets the width of each tile, in pixels.
   */
  get tileWidth() {
    const tileGrid = this.source_.getTileGrid();
    if (tileGrid) {
      const tileSizeAtZoom0 = tileGrid.getTileSize(0);
      if (Array.isArray(tileSizeAtZoom0)) {
        return tileSizeAtZoom0[0];
      } else {
        return tileSizeAtZoom0; // same width and height
      }
    }
    return 256;
  }

  /**
   * Gets the height of each tile, in pixels.
   */
  get tileHeight() {
    const tileGrid = this.source_.getTileGrid();
    if (tileGrid) {
      const tileSizeAtZoom0 = tileGrid.getTileSize(0);
      if (Array.isArray(tileSizeAtZoom0)) {
        return tileSizeAtZoom0[1];
      } else {
        return tileSizeAtZoom0; // same width and height
      }
    }
    return 256;
  }

  /**
   * Gets the maximum level-of-detail that can be requested.
   */
  get maximumLevel() {
    const tileGrid = this.source_.getTileGrid();
    if (tileGrid) {
      return tileGrid.getMaxZoom();
    } else {
      return 18; // some arbitrary value
    }
  }

  // FIXME: to implement, we could check the number of tiles at minzoom (for this rectangle) and return 0 if too big
  /**
   * Gets the minimum level-of-detail that can be requested.  Generally,
   * a minimum level should only be used when the rectangle of the imagery is small
   * enough that the number of tiles at the minimum level is small.  An imagery
   * provider with more than a few tiles at the minimum level will lead to
   * rendering problems.
   */
  get minimumLevel() {
    // WARNING: Do not use the minimum level (at least until the extent is
    // properly set). Cesium assumes the minimumLevel to contain only
    // a few tiles and tries to load them all at once -- this can
    // freeze and/or crash the browser !
    return 0;
    //var tg = this.source_.getTileGrid();
    //return tg ? tg.getMinZoom() : 0;
  }

  /**
   * Gets the tile discard policy.  If not undefined, the discard policy is responsible
   * for filtering out "missing" tiles via its shouldDiscardImage function.  If this function
   * returns undefined, no tiles are filtered.
   */
  get tileDiscardPolicy() {
    return undefined;
  }

  // FIXME: this might be exposed
  /**
   * Gets a value indicating whether or not the images provided by this imagery provider
   * include an alpha channel.  If this property is false, an alpha channel, if present, will
   * be ignored.  If this property is true, any images without an alpha channel will be treated
   * as if their alpha is 1.0 everywhere.  When this property is false, memory usage
   * and texture upload time are reduced.
   */
  get hasAlphaChannel() {
    return true;
  }

  // FIXME: this could be implemented by proxying to OL
  /**
   * Asynchronously determines what features, if any, are located at a given longitude and latitude within
   * a tile.
   * This function is optional, so it may not exist on all ImageryProviders.
   * @param x - The tile X coordinate.
   * @param y - The tile Y coordinate.
   * @param level - The tile level.
   * @param longitude - The longitude at which to pick features.
   * @param latitude - The latitude at which to pick features.
   * @return A promise for the picked features that will resolve when the asynchronous
   *                   picking completes.  The resolved value is an array of {@link ImageryLayerFeatureInfo}
   *                   instances.  The array may be empty if no features are found at the given location.
   *                   It may also be undefined if picking is not supported.
   */
  pickFeatures(x, y, level, longitude, latitude) {
    return undefined;
  }

  /**
   * Special class derived from Cesium.ImageryProvider
   * that is connected to the given ol.source.TileImage.
   * @param olMap OL map
   * @param source Tile image source
   * @param [opt_fallbackProj] Projection to assume if source has no projection
   */
  constructor(olMap, source, opt_fallbackProj) {
    this.emptyCanvas_ = createEmptyCanvas();
    this.emptyCanvasPromise_ = Promise.resolve(this.emptyCanvas_);
    this.errorEvent = new Cesium.Event();
    this.source_ = source;
    this.projection_ = null;
    this.ready_ = false;
    this.fallbackProj_ = opt_fallbackProj || null;

    // cesium v107+ don't wait for ready anymore so we put somehing here while it loads
    this.tilingScheme_ = new Cesium.WebMercatorTilingScheme();
    this.rectangle_ = null;
    this.map_ = olMap;
    this.shouldRequestNextLevel = false;
    const proxy = this.source_.get('olcs.proxy');
    if (proxy) {
      if (typeof proxy === 'function') {
        // Duck typing a proxy
        this.proxy = {
          'getURL': proxy
        };
      } else if (typeof proxy === 'string') {
        this.proxy = new Cesium.DefaultProxy(proxy);
      }
    }
    this.source_.on('change', e => {
      this.handleSourceChanged_();
    });
    this.handleSourceChanged_();
  }

  /**
   * Checks if the underlying source is ready and cached required data.
   */
  handleSourceChanged_() {
    if (!this.ready_ && this.source_.getState() == 'ready') {
      this.projection_ = (0,_util__WEBPACK_IMPORTED_MODULE_0__.getSourceProjection)(this.source_) || this.fallbackProj_;
      const options = {
        numberOfLevelZeroTilesX: 1,
        numberOfLevelZeroTilesY: 1
      };
      if (this.source_.tileGrid !== null) {
        // Get the number of tiles at level 0 if it is defined
        this.source_.tileGrid.forEachTileCoord(this.projection_.getExtent(), 0, _ref => {
          let [zoom, xIndex, yIndex] = _ref;
          options.numberOfLevelZeroTilesX = xIndex + 1;
          options.numberOfLevelZeroTilesY = yIndex + 1;
        });
      }
      if (this.projection_.getCode() === 'EPSG:4326') {
        // Cesium zoom level 0 is OpenLayers zoom level 1 for layer in EPSG:4326 with a single tile on level 0
        this.shouldRequestNextLevel = options.numberOfLevelZeroTilesX === 1 && options.numberOfLevelZeroTilesY === 1;
        this.tilingScheme_ = new Cesium.GeographicTilingScheme(options);
      } else if (this.projection_.getCode() === 'EPSG:3857') {
        this.shouldRequestNextLevel = false;
        this.tilingScheme_ = new Cesium.WebMercatorTilingScheme(options);
      } else {
        return;
      }
      this.rectangle_ = this.tilingScheme_.rectangle;
      this.ready_ = true;
    }
  }

  /**
   * Generates the proper attributions for a given position and zoom
   * level.
   * @implements
   */
  getTileCredits(x, y, level) {
    const attributionsFunction = this.source_.getAttributions();
    if (!attributionsFunction) {
      return [];
    }
    const extent = this.map_.getView().calculateExtent(this.map_.getSize());
    const center = this.map_.getView().getCenter();
    const zoom = this.shouldRequestNextLevel ? level + 1 : level;
    return (0,_core__WEBPACK_IMPORTED_MODULE_2__.attributionsFunctionToCredits)(attributionsFunction, zoom, center, extent);
  }

  /**
   * @implements
   */
  requestImage(x, y, level, request) {
    const tileUrlFunction = this.source_.getTileUrlFunction();
    if (tileUrlFunction && this.projection_) {
      const z_ = this.shouldRequestNextLevel ? level + 1 : level;
      let y_ = y;
      if (!olUseNewCoordinates) {
        // LEGACY
        // OpenLayers version 3 to 5 tile coordinates increase from bottom to top
        y_ = -y - 1;
      }
      let url = tileUrlFunction.call(this.source_, [z_, x, y_], 1, this.projection_);
      if (this.proxy) {
        url = this.proxy.getURL(url);
      }
      if (url) {
        // It is probably safe to cast here
        return Cesium.ImageryProvider.loadImage(this, url);
      }
      return this.emptyCanvasPromise_;
    } else {
      // return empty canvas to stop Cesium from retrying later
      return this.emptyCanvasPromise_;
    }
  }
}

/***/ }),

/***/ "./src/olcs/core/VectorLayerCounterpart.ts":
/*!*************************************************!*\
  !*** ./src/olcs/core/VectorLayerCounterpart.ts ***!
  \*************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ VectorLayerCounterpart)
/* harmony export */ });
/* harmony import */ var ol_Observable_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ol/Observable.js */ "ol/Observable.js");
/* harmony import */ var ol_Observable_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(ol_Observable_js__WEBPACK_IMPORTED_MODULE_0__);


/**
 * Context for feature conversion.
 */

class VectorLayerCounterpart {
  /**
  * Result of the conversion of an OpenLayers layer to Cesium.
  */
  constructor(layerProjection, scene) {
    this.olListenKeys = [];
    const billboards = new Cesium.BillboardCollection({
      scene
    });
    const primitives = new Cesium.PrimitiveCollection();
    this.rootCollection_ = new Cesium.PrimitiveCollection();
    this.context = {
      projection: layerProjection,
      billboards,
      featureToCesiumMap: {},
      primitives
    };
    this.rootCollection_.add(billboards);
    this.rootCollection_.add(primitives);
  }

  /**
  * Unlisten.
  */
  destroy() {
    this.olListenKeys.forEach(ol_Observable_js__WEBPACK_IMPORTED_MODULE_0__.unByKey);
    this.olListenKeys.length = 0;
  }
  getRootPrimitive() {
    return this.rootCollection_;
  }
}

/***/ }),

/***/ "./src/olcs/math.ts":
/*!**************************!*\
  !*** ./src/olcs/math.ts ***!
  \**************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   toDegrees: () => (/* binding */ toDegrees),
/* harmony export */   toRadians: () => (/* binding */ toRadians)
/* harmony export */ });
/**
 * Converts radians to to degrees.
 *
 * @param angleInRadians Angle in radians.
 * @return Angle in degrees.
 */
function toDegrees(angleInRadians) {
  return angleInRadians * 180 / Math.PI;
}

/**
 * Converts degrees to radians.
 *
 * @param angleInDegrees Angle in degrees.
 * @return Angle in radians.
 */
function toRadians(angleInDegrees) {
  return angleInDegrees * Math.PI / 180;
}

/***/ }),

/***/ "./src/olcs/print.ts":
/*!***************************!*\
  !*** ./src/olcs/print.ts ***!
  \***************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MaskDrawer: () => (/* reexport safe */ _print_drawCesiumMask__WEBPACK_IMPORTED_MODULE_1__.MaskDrawer),
/* harmony export */   autoDrawMask: () => (/* reexport safe */ _print_drawCesiumMask__WEBPACK_IMPORTED_MODULE_1__.autoDrawMask),
/* harmony export */   computeRectangle: () => (/* reexport safe */ _print_computeRectangle__WEBPACK_IMPORTED_MODULE_0__.computeRectangle),
/* harmony export */   takeScreenshot: () => (/* reexport safe */ _print_takeCesiumScreenshot__WEBPACK_IMPORTED_MODULE_2__.takeScreenshot)
/* harmony export */ });
/* harmony import */ var _print_computeRectangle__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./print/computeRectangle */ "./src/olcs/print/computeRectangle.ts");
/* harmony import */ var _print_drawCesiumMask__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./print/drawCesiumMask */ "./src/olcs/print/drawCesiumMask.ts");
/* harmony import */ var _print_takeCesiumScreenshot__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./print/takeCesiumScreenshot */ "./src/olcs/print/takeCesiumScreenshot.ts");




/***/ }),

/***/ "./src/olcs/print/computeRectangle.ts":
/*!********************************************!*\
  !*** ./src/olcs/print/computeRectangle.ts ***!
  \********************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   computeRectangle: () => (/* binding */ computeRectangle)
/* harmony export */ });
function computeRectangle(canvas, tw, th) {
  const maskAspectRatio = tw / th;
  let maskSize;
  if (maskAspectRatio > 1) {
    // landscape
    maskSize = [canvas.width, canvas.width / maskAspectRatio];
    if (maskSize[1] > canvas.height) {
      maskSize = [canvas.height * maskAspectRatio, canvas.height];
    }
  } else {
    // portrait
    maskSize = [canvas.height * maskAspectRatio, canvas.height];
    if (maskSize[0] > canvas.width) {
      maskSize = [canvas.width, canvas.width / maskAspectRatio];
    }
  }
  return {
    scaling: [maskSize[0] / canvas.width, maskSize[1] / canvas.height],
    width: maskSize[0],
    height: maskSize[1],
    offsetX: (canvas.width - maskSize[0]) / 2,
    offsetY: (canvas.height - maskSize[1]) / 2
  };
}

/***/ }),

/***/ "./src/olcs/print/drawCesiumMask.ts":
/*!******************************************!*\
  !*** ./src/olcs/print/drawCesiumMask.ts ***!
  \******************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MaskDrawer: () => (/* binding */ MaskDrawer),
/* harmony export */   autoDrawMask: () => (/* binding */ autoDrawMask)
/* harmony export */ });
let postUnlistener = null;
// CC0 from https://github.com/mdn/dom-examples/tree/main/webgl-examples/tutorial/sample2

class MaskDrawer {
  constructor(gl) {
    this.gl = gl;
    const shaderProgram = this.initShaderProgram();
    this.programInfo = {
      program: shaderProgram,
      attribLocations: {
        vertexPosition: gl.getAttribLocation(shaderProgram, 'aVertexPosition')
      },
      uniformLocations: {
        uScaling: gl.getUniformLocation(shaderProgram, 'uScaling')
      }
    };
    this.positionBuffer = gl.createBuffer();
    const positions = [1.0, 1.0, -1.0, 1.0, 1.0, -1.0, -1.0, -1.0];
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  }
  getVertexShaderSource() {
    return `
      attribute vec4 aVertexPosition;
      uniform vec2 uScaling;
      void main() {
        gl_Position = vec4(aVertexPosition[0] * uScaling[0], aVertexPosition[1] * uScaling[1], -1.0, 1.0);
      }
    `;
  }
  getFragmentShaderSource() {
    return `
      precision highp float;
      void main() {
        gl_FragColor = vec4(.5, .5, .5, .6);
      }
  `;
  }

  /**
   *
   */
  initShaderProgram() {
    const gl = this.gl;
    const vsSource = this.getVertexShaderSource();
    const fsSource = this.getFragmentShaderSource();
    const vertexShader = MaskDrawer.loadShader(gl, gl.VERTEX_SHADER, vsSource),
      fragmentShader = MaskDrawer.loadShader(gl, gl.FRAGMENT_SHADER, fsSource),
      shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    // If creating the shader program failed, alert

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
      throw new Error(`Unable to initialize the shader program: ${gl.getProgramInfoLog(shaderProgram)}`);
    }
    return shaderProgram;
  }

  /**
   *
   * @param {number[]} scaling scaling
   */
  drawMask(scaling) {
    const gl = this.gl;
    const programInfo = this.programInfo;
    // Blend
    gl.enable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.vertexAttribPointer(programInfo.attribLocations.vertexPosition, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);
    gl.useProgram(programInfo.program);

    // Draw a first time to fill the stencil area while keeping the destination color
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.ALWAYS, 1, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.uniform2fv(programInfo.uniformLocations.uScaling, scaling);
    gl.blendFunc(gl.ZERO, gl.ONE);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Now draw again the whole viewport and darken the pixels that are not on the stencil
    gl.stencilFunc(gl.EQUAL, 0, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.uniform2fv(programInfo.uniformLocations.uScaling, [1, 1]);
    gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   */
  static loadShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`An error occurred compiling the shaders: ${gl.getShaderInfoLog(shader)}`);
      // gl.deleteShader(shader);
    }
    return shader;
  }
}

/**
 *
 */
function autoDrawMask(scene, getScalings) {
  const canvas = scene.canvas;
  const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (getScalings) {
    if (!postUnlistener) {
      const drawer = new MaskDrawer(ctx);
      postUnlistener = scene.postRender.addEventListener(() => {
        drawer.drawMask(getScalings());
      });
    }
  } else if (postUnlistener) {
    postUnlistener();
    // FIXME: destroy program
    postUnlistener = null;
  }
  scene.requestRender();
}

/***/ }),

/***/ "./src/olcs/print/takeCesiumScreenshot.ts":
/*!************************************************!*\
  !*** ./src/olcs/print/takeCesiumScreenshot.ts ***!
  \************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   takeScreenshot: () => (/* binding */ takeScreenshot)
/* harmony export */ });
/**
 */
function takeScreenshot(scene, options) {
  return new Promise((resolve, reject) => {
    // preserveDrawingBuffers is false so we render on demand and immediately read the buffer
    const remover = scene.postRender.addEventListener(() => {
      remover();
      try {
        let url;
        if (options) {
          const smallerCanvas = document.createElement('canvas');
          smallerCanvas.width = options.width;
          smallerCanvas.height = options.height;
          smallerCanvas.getContext('2d').drawImage(scene.canvas, options.offsetX, options.offsetY, options.width, options.height, 0, 0, options.width, options.height);
          url = smallerCanvas.toDataURL();
        } else {
          url = scene.canvas.toDataURL();
        }
        resolve(url);
      } catch (e) {
        reject(e);
      }
    });
    scene.requestRender();
  });
}

/***/ }),

/***/ "./src/olcs/util.ts":
/*!**************************!*\
  !*** ./src/olcs/util.ts ***!
  \**************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   getSourceProjection: () => (/* binding */ getSourceProjection),
/* harmony export */   getUid: () => (/* binding */ getUid),
/* harmony export */   imageRenderingValue: () => (/* binding */ imageRenderingValue),
/* harmony export */   supportsImageRenderingPixelated: () => (/* binding */ supportsImageRenderingPixelated),
/* harmony export */   waitReady: () => (/* binding */ waitReady)
/* harmony export */ });
let _imageRenderingPixelatedSupported = undefined;
let _imageRenderingValue = undefined;

/**
 * https://caniuse.com/mdn-css_properties_image-rendering_pixelated
 * @return whether the browser supports
 */
function supportsImageRenderingPixelated() {
  if (_imageRenderingPixelatedSupported === undefined) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('style', 'image-rendering: -moz-crisp-edges; image-rendering: crisp-edges; image-rendering: pixelated;');
    // canvas.style.imageRendering will be undefined, null or an
    // empty string on unsupported browsers.
    const imageRenderingValue = canvas.style.imageRendering;
    _imageRenderingPixelatedSupported = !!imageRenderingValue;
    if (_imageRenderingPixelatedSupported) {
      _imageRenderingValue = imageRenderingValue;
    }
  }
  return _imageRenderingPixelatedSupported;
}

/**
 * The value supported by thie browser for the CSS property "image-rendering"
 * @return {string}
 */
function imageRenderingValue() {
  supportsImageRenderingPixelated();
  return _imageRenderingValue || '';
}

/**
 * Return the projection of the source that Cesium should use.
 *
 * @param source Source.
 * @return The projection of the source.
 */
function getSourceProjection(source) {
  return source.get('olcs.projection') || source.getProjection();
}

/**
 * Counter for getUid.
 * @type {number}
 */
let uidCounter_ = 0;

/**
 * Gets a unique ID for an object. This mutates the object so that further calls
 * with the same object as a parameter returns the same value. Unique IDs are generated
 * as a strictly increasing sequence. Adapted from goog.getUid. Similar to OL getUid.
 *
 * @param obj The object to get the unique ID for.
 * @return The unique ID for the object.
 */
function getUid(obj) {
  return obj.olcs_uid || (obj.olcs_uid = ++uidCounter_);
}
function waitReady(object) {
  const o = object;
  const p = o.readyPromise;
  if (p) {
    return p;
  }
  if (o.ready !== undefined) {
    if (o.ready) {
      return Promise.resolve(object);
    }
    return new Promise((resolve, _) => {
      // FIXME: this is crazy
      // alternative: intercept _ready = true
      // altnerative: pass a timeout
      const stopper = setInterval(() => {
        if (o.ready) {
          clearInterval(stopper);
          resolve(object);
        }
      }, 20);
    });
  }
  return Promise.reject('Not a readyable object');
}

/***/ }),

/***/ "ol/Observable.js":
/*!********************************!*\
  !*** external "ol.Observable" ***!
  \********************************/
/***/ ((module) => {

module.exports = ol.Observable;

/***/ }),

/***/ "ol/Overlay.js":
/*!*****************************!*\
  !*** external "ol.Overlay" ***!
  \*****************************/
/***/ ((module) => {

module.exports = ol.Overlay;

/***/ }),

/***/ "ol/easing.js":
/*!****************************!*\
  !*** external "ol.easing" ***!
  \****************************/
/***/ ((module) => {

module.exports = ol.easing;

/***/ }),

/***/ "ol/extent.js":
/*!****************************!*\
  !*** external "ol.extent" ***!
  \****************************/
/***/ ((module) => {

module.exports = ol.extent;

/***/ }),

/***/ "ol/format/MVT.js":
/*!********************************!*\
  !*** external "ol.format.MVT" ***!
  \********************************/
/***/ ((module) => {

module.exports = ol.format.MVT;

/***/ }),

/***/ "ol/geom.js":
/*!**************************!*\
  !*** external "ol.geom" ***!
  \**************************/
/***/ ((module) => {

module.exports = ol.geom;

/***/ }),

/***/ "ol/geom/Point.js":
/*!********************************!*\
  !*** external "ol.geom.Point" ***!
  \********************************/
/***/ ((module) => {

module.exports = ol.geom.Point;

/***/ }),

/***/ "ol/geom/Polygon.js":
/*!**********************************!*\
  !*** external "ol.geom.Polygon" ***!
  \**********************************/
/***/ ((module) => {

module.exports = ol.geom.Polygon;

/***/ }),

/***/ "ol/geom/SimpleGeometry.js":
/*!*****************************************!*\
  !*** external "ol.geom.SimpleGeometry" ***!
  \*****************************************/
/***/ ((module) => {

module.exports = ol.geom.SimpleGeometry;

/***/ }),

/***/ "ol/layer/BaseVector.js":
/*!**************************************!*\
  !*** external "ol.layer.BaseVector" ***!
  \**************************************/
/***/ ((module) => {

module.exports = ol.layer.BaseVector;

/***/ }),

/***/ "ol/layer/Group.js":
/*!*********************************!*\
  !*** external "ol.layer.Group" ***!
  \*********************************/
/***/ ((module) => {

module.exports = ol.layer.Group;

/***/ }),

/***/ "ol/layer/Image.js":
/*!*********************************!*\
  !*** external "ol.layer.Image" ***!
  \*********************************/
/***/ ((module) => {

module.exports = ol.layer.Image;

/***/ }),

/***/ "ol/layer/Layer.js":
/*!*********************************!*\
  !*** external "ol.layer.Layer" ***!
  \*********************************/
/***/ ((module) => {

module.exports = ol.layer.Layer;

/***/ }),

/***/ "ol/layer/Tile.js":
/*!********************************!*\
  !*** external "ol.layer.Tile" ***!
  \********************************/
/***/ ((module) => {

module.exports = ol.layer.Tile;

/***/ }),

/***/ "ol/layer/Vector.js":
/*!**********************************!*\
  !*** external "ol.layer.Vector" ***!
  \**********************************/
/***/ ((module) => {

module.exports = ol.layer.Vector;

/***/ }),

/***/ "ol/layer/VectorTile.js":
/*!**************************************!*\
  !*** external "ol.layer.VectorTile" ***!
  \**************************************/
/***/ ((module) => {

module.exports = ol.layer.VectorTile;

/***/ }),

/***/ "ol/proj.js":
/*!**************************!*\
  !*** external "ol.proj" ***!
  \**************************/
/***/ ((module) => {

module.exports = ol.proj;

/***/ }),

/***/ "ol/render.js":
/*!****************************!*\
  !*** external "ol.render" ***!
  \****************************/
/***/ ((module) => {

module.exports = ol.render;

/***/ }),

/***/ "ol/render/Feature.js":
/*!************************************!*\
  !*** external "ol.render.Feature" ***!
  \************************************/
/***/ ((module) => {

module.exports = ol.render.Feature;

/***/ }),

/***/ "ol/source.js":
/*!****************************!*\
  !*** external "ol.source" ***!
  \****************************/
/***/ ((module) => {

module.exports = ol.source;

/***/ }),

/***/ "ol/source/Cluster.js":
/*!************************************!*\
  !*** external "ol.source.Cluster" ***!
  \************************************/
/***/ ((module) => {

module.exports = ol.source.Cluster;

/***/ }),

/***/ "ol/source/Image.js":
/*!**********************************!*\
  !*** external "ol.source.Image" ***!
  \**********************************/
/***/ ((module) => {

module.exports = ol.source.Image;

/***/ }),

/***/ "ol/source/ImageStatic.js":
/*!****************************************!*\
  !*** external "ol.source.ImageStatic" ***!
  \****************************************/
/***/ ((module) => {

module.exports = ol.source.ImageStatic;

/***/ }),

/***/ "ol/source/ImageWMS.js":
/*!*************************************!*\
  !*** external "ol.source.ImageWMS" ***!
  \*************************************/
/***/ ((module) => {

module.exports = ol.source.ImageWMS;

/***/ }),

/***/ "ol/source/TileImage.js":
/*!**************************************!*\
  !*** external "ol.source.TileImage" ***!
  \**************************************/
/***/ ((module) => {

module.exports = ol.source.TileImage;

/***/ }),

/***/ "ol/source/TileWMS.js":
/*!************************************!*\
  !*** external "ol.source.TileWMS" ***!
  \************************************/
/***/ ((module) => {

module.exports = ol.source.TileWMS;

/***/ }),

/***/ "ol/source/Vector.js":
/*!***********************************!*\
  !*** external "ol.source.Vector" ***!
  \***********************************/
/***/ ((module) => {

module.exports = ol.source.Vector;

/***/ }),

/***/ "ol/source/VectorTile.js":
/*!***************************************!*\
  !*** external "ol.source.VectorTile" ***!
  \***************************************/
/***/ ((module) => {

module.exports = ol.source.VectorTile;

/***/ }),

/***/ "ol/structs/LRUCache.js":
/*!**************************************!*\
  !*** external "ol.structs.LRUCache" ***!
  \**************************************/
/***/ ((module) => {

module.exports = ol.structs.LRUCache;

/***/ }),

/***/ "ol/style/Icon.js":
/*!********************************!*\
  !*** external "ol.style.Icon" ***!
  \********************************/
/***/ ((module) => {

module.exports = ol.style.Icon;

/***/ }),

/***/ "ol/style/Stroke.js":
/*!**********************************!*\
  !*** external "ol.style.Stroke" ***!
  \**********************************/
/***/ ((module) => {

module.exports = ol.style.Stroke;

/***/ }),

/***/ "ol/style/Style.js":
/*!*********************************!*\
  !*** external "ol.style.Style" ***!
  \*********************************/
/***/ ((module) => {

module.exports = ol.style.Style;

/***/ }),

/***/ "ol/tilegrid.js":
/*!******************************!*\
  !*** external "ol.tilegrid" ***!
  \******************************/
/***/ ((module) => {

module.exports = ol.tilegrid;

/***/ }),

/***/ "ol/tileurlfunction.js":
/*!*************************************!*\
  !*** external "ol.tileurlfunction" ***!
  \*************************************/
/***/ ((module) => {

module.exports = ol.tileurlfunction;

/***/ }),

/***/ "ol/util.js":
/*!**************************!*\
  !*** external "ol.util" ***!
  \**************************/
/***/ ((module) => {

module.exports = ol.util;

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat get default export */
/******/ 	(() => {
/******/ 		// getDefaultExport function for compatibility with non-harmony modules
/******/ 		__webpack_require__.n = (module) => {
/******/ 			var getter = module && module.__esModule ?
/******/ 				() => (module['default']) :
/******/ 				() => (module);
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
(() => {
/*!*********************!*\
  !*** ./src/olcs.ts ***!
  \*********************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   AbstractSynchronizer: () => (/* reexport safe */ _olcs_AbstractSynchronizer__WEBPACK_IMPORTED_MODULE_1__["default"]),
/* harmony export */   ContribLazyLoader: () => (/* reexport safe */ _olcs_contrib_LazyLoader__WEBPACK_IMPORTED_MODULE_11__["default"]),
/* harmony export */   ContribManager: () => (/* reexport safe */ _olcs_contrib_Manager__WEBPACK_IMPORTED_MODULE_10__["default"]),
/* harmony export */   FeatureConverter: () => (/* reexport safe */ _olcs_FeatureConverter__WEBPACK_IMPORTED_MODULE_4__["default"]),
/* harmony export */   MaskDrawer: () => (/* reexport safe */ _olcs_print__WEBPACK_IMPORTED_MODULE_9__.MaskDrawer),
/* harmony export */   OLCSCamera: () => (/* reexport safe */ _olcs_Camera__WEBPACK_IMPORTED_MODULE_5__["default"]),
/* harmony export */   OLImageryProvider: () => (/* reexport safe */ _olcs_core_OLImageryProvider__WEBPACK_IMPORTED_MODULE_7__["default"]),
/* harmony export */   RasterSynchronizer: () => (/* reexport safe */ _olcs_RasterSynchronizer__WEBPACK_IMPORTED_MODULE_2__["default"]),
/* harmony export */   VectorLayerCounterpart: () => (/* reexport safe */ _olcs_core_VectorLayerCounterpart__WEBPACK_IMPORTED_MODULE_8__["default"]),
/* harmony export */   VectorSynchronizer: () => (/* reexport safe */ _olcs_VectorSynchronizer__WEBPACK_IMPORTED_MODULE_3__["default"]),
/* harmony export */   applyHeightOffsetToGeometry: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.applyHeightOffsetToGeometry),
/* harmony export */   attributionsFunctionToCredits: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.attributionsFunctionToCredits),
/* harmony export */   autoDrawMask: () => (/* reexport safe */ _olcs_print__WEBPACK_IMPORTED_MODULE_9__.autoDrawMask),
/* harmony export */   bottomFovRay: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.bottomFovRay),
/* harmony export */   calcDistanceForResolution: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.calcDistanceForResolution),
/* harmony export */   calcResolutionForDistance: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.calcResolutionForDistance),
/* harmony export */   computeAngleToZenith: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.computeAngleToZenith),
/* harmony export */   computeBoundingBoxAtTarget: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.computeBoundingBoxAtTarget),
/* harmony export */   computePixelSizeAtCoordinate: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.computePixelSizeAtCoordinate),
/* harmony export */   computeRectangle: () => (/* reexport safe */ _olcs_print__WEBPACK_IMPORTED_MODULE_9__.computeRectangle),
/* harmony export */   computeSignedTiltAngleOnGlobe: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.computeSignedTiltAngleOnGlobe),
/* harmony export */   convertColorToCesium: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.convertColorToCesium),
/* harmony export */   convertUrlToCesium: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.convertUrlToCesium),
/* harmony export */   createMatrixAtCoordinates: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.createMatrixAtCoordinates),
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__),
/* harmony export */   extentToRectangle: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.extentToRectangle),
/* harmony export */   isCesiumProjection: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.isCesiumProjection),
/* harmony export */   limitCameraToBoundingSphere: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.limitCameraToBoundingSphere),
/* harmony export */   normalizeView: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.normalizeView),
/* harmony export */   ol4326CoordinateArrayToCsCartesians: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.ol4326CoordinateArrayToCsCartesians),
/* harmony export */   ol4326CoordinateToCesiumCartesian: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.ol4326CoordinateToCesiumCartesian),
/* harmony export */   olGeometryCloneTo4326: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.olGeometryCloneTo4326),
/* harmony export */   pickBottomPoint: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.pickBottomPoint),
/* harmony export */   pickCenterPoint: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.pickCenterPoint),
/* harmony export */   pickOnTerrainOrEllipsoid: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.pickOnTerrainOrEllipsoid),
/* harmony export */   resetToNorthZenith: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.resetToNorthZenith),
/* harmony export */   rotateAroundAxis: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.rotateAroundAxis),
/* harmony export */   rotateAroundBottomCenter: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.rotateAroundBottomCenter),
/* harmony export */   setHeadingUsingBottomCenter: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.setHeadingUsingBottomCenter),
/* harmony export */   signedAngleBetween: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.signedAngleBetween),
/* harmony export */   sourceToImageryProvider: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.sourceToImageryProvider),
/* harmony export */   takeScreenshot: () => (/* reexport safe */ _olcs_print__WEBPACK_IMPORTED_MODULE_9__.takeScreenshot),
/* harmony export */   tileLayerToImageryLayer: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.tileLayerToImageryLayer),
/* harmony export */   updateCesiumLayerProperties: () => (/* reexport safe */ _olcs_core__WEBPACK_IMPORTED_MODULE_6__.updateCesiumLayerProperties)
/* harmony export */ });
/* harmony import */ var _olcs_OLCesium__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./olcs/OLCesium */ "./src/olcs/OLCesium.ts");
/* harmony import */ var _olcs_AbstractSynchronizer__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./olcs/AbstractSynchronizer */ "./src/olcs/AbstractSynchronizer.ts");
/* harmony import */ var _olcs_RasterSynchronizer__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./olcs/RasterSynchronizer */ "./src/olcs/RasterSynchronizer.ts");
/* harmony import */ var _olcs_VectorSynchronizer__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./olcs/VectorSynchronizer */ "./src/olcs/VectorSynchronizer.ts");
/* harmony import */ var _olcs_FeatureConverter__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./olcs/FeatureConverter */ "./src/olcs/FeatureConverter.ts");
/* harmony import */ var _olcs_Camera__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./olcs/Camera */ "./src/olcs/Camera.ts");
/* harmony import */ var _olcs_core__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./olcs/core */ "./src/olcs/core.ts");
/* harmony import */ var _olcs_core_OLImageryProvider__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./olcs/core/OLImageryProvider */ "./src/olcs/core/OLImageryProvider.ts");
/* harmony import */ var _olcs_core_VectorLayerCounterpart__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./olcs/core/VectorLayerCounterpart */ "./src/olcs/core/VectorLayerCounterpart.ts");
/* harmony import */ var _olcs_print__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ./olcs/print */ "./src/olcs/print.ts");
/* harmony import */ var _olcs_contrib_Manager__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! ./olcs/contrib/Manager */ "./src/olcs/contrib/Manager.ts");
/* harmony import */ var _olcs_contrib_LazyLoader__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(/*! ./olcs/contrib/LazyLoader */ "./src/olcs/contrib/LazyLoader.ts");

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_olcs_OLCesium__WEBPACK_IMPORTED_MODULE_0__["default"]);






// Core api functions




// Print functions


// Contrib Manager



// Deprecated export of olcs on window
const olcs = window['olcs'] = {};
olcs.OLCesium = _olcs_OLCesium__WEBPACK_IMPORTED_MODULE_0__["default"];



olcs.AbstractSynchronizer = _olcs_AbstractSynchronizer__WEBPACK_IMPORTED_MODULE_1__["default"];
olcs.RasterSynchronizer = _olcs_RasterSynchronizer__WEBPACK_IMPORTED_MODULE_2__["default"];
olcs.VectorSynchronizer = _olcs_VectorSynchronizer__WEBPACK_IMPORTED_MODULE_3__["default"];



olcs.core = _olcs_core__WEBPACK_IMPORTED_MODULE_6__;
olcs.core.OLImageryProvider = _olcs_core_OLImageryProvider__WEBPACK_IMPORTED_MODULE_7__["default"];
olcs.core.VectorLayerCounterpart = _olcs_core_VectorLayerCounterpart__WEBPACK_IMPORTED_MODULE_8__["default"];
olcs.contrib = {};


olcs.contrib.LazyLoader = _olcs_contrib_LazyLoader__WEBPACK_IMPORTED_MODULE_11__["default"];
olcs.contrib.Manager = _olcs_contrib_Manager__WEBPACK_IMPORTED_MODULE_10__["default"];
})();

olcs_unused_var = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=olcesium-debug.js.map