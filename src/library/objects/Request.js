/* Request.js
KC3改 API Requests

Instantiatable class to represent a single API call
Executes processing and relies on KC3Network for the triggers
*/
(function(){
	"use strict";
	
	window.KC3Request = function(har){
		// HAR Specification (v1.2) see: http://www.softwareishard.com/blog/har-12-spec/
		// Deep clone for avoiding direct references to HAR object members
		if(har){
			this.url = String(har.request.url);
			this.headers = $.extend(true, [], har.response.headers);
			this.statusCode = har.response.status;
			this.params = $.extend(true, [], har.request.postData.params);
			this.call = this.url.substring(this.url.indexOf("/kcsapi/") + 8);
		}
		this.gameStatus = 0;
		this.response = {};
	};
	
	/* VALIDATE HEADERS
	
	------------------------------------------*/
	KC3Request.prototype.validateHeaders = function(){
		// If response header statusCode is not 200, means non-in-game error
		if(this.statusCode !== 200){
			// Do not trigger a catbomb box if server responds following:
			if(this.statusCode === 302 || this.statusCode === 307){
				console.warn("Response temporary redirect:", this.statusCode, this.url, this.headers);
				return false;
			}
			console.warn("Response status invalid:", this.statusCode, this.url, this.headers);
			KC3Network.trigger("CatBomb", {
				title: KC3Meta.term("CatBombServerCommErrorTitle"),
				message: KC3Meta.term("CatBombServerCommErrorMsg").format([this.call])
			});
			return false;
		}
		
		// Reformat headers array to name-value object
		var headersReformatted = {};
		$.each(this.headers, function(index, element){
			headersReformatted[ element.name ] = element.value;
		});
		this.headers = headersReformatted;
		
		// Reformat and decode parameters
		var paramsReformatted = {};
		var paramsDecoded = {};
		$.each(this.params, function(index, element){
			var paramName = decodeURI(element.name);
			paramsReformatted[ paramName ] = element.value;
			paramsDecoded[ paramName ] = decodeURIComponent(element.value || "");
		});
		this.params = paramsReformatted;
		this.paramsDecoded = paramsDecoded;
		
		return true;
	};
	
	/* READ RESPONSE
	
	------------------------------------------*/
	KC3Request.prototype.readResponse = function(har, callback){
		var self = this;
		// Get response body
		har.getContent(function(responseBody){
			// Strip svdata= from response body if exists then parse JSON
			if(responseBody.indexOf("svdata=") >- 1){
				responseBody = responseBody.substring(7);
			}
			var responseObj = JSON.parse(responseBody);
			
			self.gameStatus = responseObj.api_result;
			self.response = responseObj;
			
			callback();
		});
	};
	
	/* VALIDATE DATA
	
	------------------------------------------*/
	KC3Request.prototype.validateData = function(){
		// If gameStatus is not 1. Game API returns 1 if complete success
		if(this.gameStatus != 1){
			console.warn("Game Status Error:", this.gameStatus, this.response);
			
			// Error 201
			if (parseInt(this.gameStatus, 10) === 201) {
				KC3Network.trigger("Bomb201", {
					title: KC3Meta.term("Bomb201Title"),
					message: KC3Meta.term("Bomb201Message")
				});
				return false;
			}
			
			// If it fails on "api_start2" which is the first API call
			if(this.call.indexOf("api_start2") > -1){
				KC3Network.trigger( "CatBomb", {
					title: KC3Meta.term("CatBombHardAPIErrorTitle"),
					message: KC3Meta.term("CatBombHardAPIErrorMsg")
				});
				return false;
			}
			
			// If it fails on "api_port" which is usually caused by system clock
			if(this.call == "api_port/port"){
				// Check if user's clock is correct
				var computerClock = new Date().getTime();
				var serverClock = new Date( this.headers.Date ).getTime();
				
				// If clock difference is greater than 5 minutes
				var timeDiff = Math.abs(computerClock - serverClock);
				if(timeDiff > 300000){
					KC3Network.trigger("CatBomb", {
						title: KC3Meta.term("CatBombWrongComputerClockTitle"),
						message: KC3Meta.term("CatBombWrongComputerClockMsg").format(Math.ceil(timeDiff/60000))
					});
					
				// Something else other than clock is wrong
				}else{
					KC3Network.trigger("CatBomb", {
						title: KC3Meta.term("CatBombErrorOnHomePortTitle"),
						message: KC3Meta.term("CatBombErrorOnHomePortMsg")
					});
				}
				return false;
			}
			
			// Some other API Call failed
			KC3Network.trigger("CatBomb", {
				title: KC3Meta.term("CatBombAPIDataErrorTitle"),
				message: KC3Meta.term("CatBombAPIDataErrorMsg")
			});
			
			return false;
		} else {
			// Check availability of the headers.Date
			if(!this.headers.Date) {
				if(!KC3Request.headerReminder) {
					KC3Network.trigger("CatBomb", {
						title: KC3Meta.term("CatBombMissingServerTimeTitle"),
						message: KC3Meta.term("CatBombMissingServerTimeMsg")
					});
					KC3Request.headerReminder = true;
				}
				// Fallback to use local machine time
				this.headers.Date = new Date().toUTCString();
			}
		}
		return true;
	};
	
	/* PROCESS
	
	------------------------------------------*/
	KC3Request.prototype.process = function(){
		// If API call is supported
		if(typeof Kcsapi[this.call] === "function"){
			// check clock and clear quests at 5AM JST
			var serverTime = Date.safeToUtcTime( this.headers.Date );
			KC3QuestManager.checkAndResetQuests(serverTime);
			
			// Execute by passing data
			try {
				Kcsapi[this.call]( this.params, this.response, this.headers, this.paramsDecoded );
			} catch (e) {
				var reportParams = $.extend({}, this.params);
				// Protect player's privacy
				delete reportParams.api_token;
				KC3Network.trigger("APIError", {
					title: KC3Meta.term("APIErrorNoticeTitle"),
					message: KC3Meta.term("APIErrorNoticeMessage").format([this.call]),
					stack: e.stack || String(e),
					request: {
						url: this.url,
						headers: this.headers,
						statusCode: this.statusCode
					},
					params: reportParams,
					response: this.response,
					serverUtc: serverTime,
					kc3Manifest: chrome.runtime.getManifest()
				});
				// Keep stack logging in extension's console
				console.error("Game API Call Error:", e);/*RemoveLogging:skip*/
			}
		}
	};
	
})();
