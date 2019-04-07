/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";

	const settings = require("../lib/settings");
	const {parseErrorStack} = require("../lib/callingStack");
	const {error, warning, message, notice, verbose, setPrefix: setLogPrefix} = require("../lib/logging");
	setLogPrefix("page action script");

	const domainNotification = require("./domainNotification");
	const Notification = require("./Notification");
	const {createActionButtons, modalPrompt, modalChoice} = require("./gui");
	const lists = require("../lib/lists");

	Promise.all([
		browser.tabs.query({active: true, currentWindow: true}),
		settings.loaded
	]).then(function(values){
		// load theme
		var themeLink = document.createElement("link");
		themeLink.href = `pageAction-${settings.theme}.css`;
		themeLink.rel = "stylesheet";
		themeLink.type = "text/css";
		document.head.appendChild(themeLink);
		settings.on("theme", function(){
			themeLink.href = `pageAction-${settings.theme}.css`;
		});
		
		const tabs = values[0];
		
		notice("create global action buttons");

		createActionButtons(
			document.getElementById("globalActions"),
			[
				{
					name: "showOptions",
					isIcon: true,
					callback: function(){
						if (browser.runtime && browser.runtime.openOptionsPage){
							browser.runtime.openOptionsPage();
						}
						else {
							window.open(browser.extension.getURL("options/options.html"), "_blank");
						}
					}
				},
				{
					name: "disableNotifications",
					isIcon: true,
					callback: function(){
						settings.set("showNotifications", false).then(function(){
							window.close();
						});
					}
				}
			],
			undefined,
			true
		);
		
		if (!tabs.length){
			throw new Error("noTabsFound");
		}
		else if (tabs.length > 1){
			error(tabs);
			throw new Error("tooManyTabsFound");
		}
		
		function domainOrUrlPicker(domain, urls, selectText, urlInputText){
			const choices = Array.from(urls).map(function(url){
				return {
					text: url,
					value: "^" + url.replace(/([\\+*?[^\]$(){}=!|.])/g, "\\$1") + "$"
				};
			});
			choices.unshift(domain);
			return modalChoice(
				selectText,
				choices
			).then(function(choice){
				if (choice.startsWith("^")){
					return modalPrompt(
						urlInputText,
						choice
					);
				}
				else {
					return choice;
				}
			});
		}
		
		verbose("registering domain actions");
		[
			{
				name: "ignorelist",
				isIcon: true,
				callback: function({domain, urls}){
					domainOrUrlPicker(
						domain,
						urls,
						browser.i18n.getMessage("selectIgnore"),
						browser.i18n.getMessage("inputIgnoreURL")
					).then(function(choice){
						if (choice){
							settings.set("showNotifications", false, choice).then(function(){
								window.close();
							});
						}
						else {
							window.close();
						}
					});
				}
			},
			{
				name: "whitelist",
				isIcon: true,
				callback: function({domain, urls}){
					domainOrUrlPicker(
						domain,
						urls,
						browser.i18n.getMessage("selectWhitelist"),
						browser.i18n.getMessage("inputWhitelistURL")
					).then(function(choice){
						if (choice){
							settings.set("blockMode", "allow", choice).then(function(){
								window.close();
							});
						}
						else {
							window.close();
						}
					});
				}
			},
			{
				name: "whitelistTemporarily",
				isIcon: true,
				callback: function({domain, urls}){
					domainOrUrlPicker(
						domain,
						urls,
						browser.i18n.getMessage("selectSessionWhitelist"),
						browser.i18n.getMessage("inputSessionWhitelistURL")
					).then(function(choice){
						if (choice){
							lists.appendTo("sessionWhite", choice).then(function(){
								window.close();
							});
						}
						else {
							window.close();
						}
					});
				}
			}
		].forEach(function(domainAction){
			domainNotification.addAction(domainAction);
		});

		verbose("registering notification actions");
		[
			{
				name: "displayFullURL",
				isIcon: true,
				callback: function({url}){
					alert(url.href);
				}
			},
			{
				name: "displayCallingStack",
				isIcon: true,
				callback: function({errorStack}){
					alert(parseErrorStack(errorStack));
				}
			}
		].forEach(function(action){
			Notification.addAction(action);
		});
		
		var tab = tabs[0];
		browser.runtime.onMessage.addListener(function(data){
			if (data["canvasBlocker-notificationCounter"]){
				const url = new URL(data.url);
				Object.keys(data["canvasBlocker-notificationCounter"]).forEach(function(key){
					const notification = domainNotification(
						url,
						key,
						data["canvasBlocker-notificationCounter"][key]
					);
				});
			}
			if (
				Array.isArray(data["canvasBlocker-notifications"]) &&
				data["canvasBlocker-notifications"].length
			){
				message("got notifications");
				const notifications = data["canvasBlocker-notifications"];
				let i = 0;
				const length = notifications.length;
				const tick = window.setInterval(function(){
					if (i >= length){
						window.clearInterval(tick);
					}
					else {
						for (var delta = 0; delta < 20 && i + delta < length; delta += 1){
							let notification = notifications[i + delta];
							verbose(notification);
							if (settings.ignoredAPIs[notification.api]){
								continue;
							}
							verbose(notification);
							notification.url = new URL(notification.url);
							domainNotification(
								notification.url,
								notification.messageId
							).addNotification(new Notification(notification));
						}
						i += delta;
					}
				}, 1);
			}
		});
		message("request notifications from tab", tab.id);
		browser.tabs.sendMessage(
			tab.id,
			{
				"canvasBlocker-sendNotifications": tab.id
			}
		);
		notice("waiting for notifications");
	}).catch(function(e){
		error(e);
	});
}());